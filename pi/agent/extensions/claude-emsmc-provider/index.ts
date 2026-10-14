import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ClaudeSession, type ClaudeEffort, type ClaudeMessage, type ClaudeTier } from "./claude-session.ts";

const SESSION_ENTRY = "claude-emsmc-provider-session-v1";
const STATUS_ID = "claude-emsmc-provider";
const API_KEY_ENV_VAR = "EMSMC_ANTHROPIC_API_KEY";

interface SessionState {
	tier?: ClaudeTier;
	sessionId?: string;
	syncedContextLength: number;
}

interface TextPart {
	type: "text";
	text: string;
}

interface ImagePart {
	type: "image";
	data: string;
	mimeType: string;
}

function assistantText(message: { content: unknown }): string {
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part): part is TextPart => Boolean(part && typeof part === "object" && (part as TextPart).type === "text"))
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function userText(message: { content: string | Array<TextPart | ImagePart> }): string {
	if (typeof message.content === "string") return message.content;
	return message.content.filter((part): part is TextPart => part.type === "text").map((part) => part.text).join("\n");
}

function formatExternalMessages(messages: Context["messages"]): string {
	const formatted = messages.flatMap((message) => {
		if (message.role === "user") return [`User: ${userText(message)}`];
		if (message.role === "assistant") return [`Assistant shown by Pi: ${assistantText(message)}`];
		if (message.role === "toolResult") {
			const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
			return [`Pi tool result (${message.toolName}): ${text}`];
		}
		return [];
	});
	return formatted.join("\n\n").trim();
}

function toClaudeUserMessage(
	message: Extract<Context["messages"][number], { role: "user" }>,
	prefix?: string,
): ClaudeMessage {
	if (typeof message.content === "string") {
		return { role: "user" as const, content: prefix ? `${prefix}\n\n${message.content}` : message.content };
	}

	const content: unknown[] = [];
	if (prefix) content.push({ type: "text", text: prefix });
	for (const part of message.content) {
		if (part.type === "text") content.push({ type: "text", text: part.text });
		else {
			content.push({
				type: "image",
				source: { type: "base64", media_type: part.mimeType, data: part.data },
			});
		}
	}
	return { role: "user", content: content as ClaudeMessage["content"] };
}

function latestUserMessage(context: Context) {
	for (let index = context.messages.length - 1; index >= 0; index--) {
		const message = context.messages[index];
		if (message?.role === "user") return message;
	}
	return undefined;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFromResult(result: { usage: unknown }): Usage {
	const raw = result.usage as Record<string, unknown>;
	const input = numberValue(raw.input_tokens);
	const output = numberValue(raw.output_tokens);
	const cacheRead = numberValue(raw.cache_read_input_tokens);
	const cacheWrite = numberValue(raw.cache_creation_input_tokens);
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function failedMessage(model: Model<Api>, error: unknown, aborted: boolean): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: aborted ? "aborted" : "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

function effortFromReasoning(reasoning: SimpleStreamOptions["reasoning"]): ClaudeEffort {
	if (reasoning === "low" || reasoning === "medium" || reasoning === "high") return reasoning;
	return "high";
}

function isClaudeTier(value: string): value is ClaudeTier {
	return value === "opus" || value === "sonnet";
}

/**
 * Registers claude-emsmc/opus and claude-emsmc/sonnet as Pi models, bridged through the
 * real Claude Code CLI exactly like claude-cli-provider's `fable` model — except this one
 * authenticates with the EMSMC company API key (never the personal Claude.ai subscription)
 * and never sends any text to a second model. There is no editor/rewrite pass here on
 * purpose: claude-cli-provider's Luna rewrite step forwards Claude's answer and the user's
 * request to `openai-codex/gpt-5.6-luna`, which is unacceptable for company data. Keep
 * these two extensions isolated from each other; do not reintroduce that step here.
 */
export default function claudeEmsmcProvider(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let session: ClaudeSession | undefined;
	let state: SessionState = { syncedContextLength: 0 };

	const setStatus = (text?: string) => ctx?.ui.setStatus(STATUS_ID, text);

	const persistSessionState = () => pi.appendEntry(SESSION_ENTRY, { ...state });

	const closeSession = async () => {
		const current = session;
		session = undefined;
		await current?.close();
		setStatus();
	};

	const resetClaudeMapping = async (tier?: ClaudeTier) => {
		await closeSession();
		state = { tier, syncedContextLength: 0 };
		persistSessionState();
	};

	const reconstruct = (event: { reason: string }, current: ExtensionContext) => {
		ctx = current;
		state = { syncedContextLength: 0 };

		for (const entry of current.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY) continue;
			if (!entry.data || typeof entry.data !== "object") continue;
			const saved = entry.data as Partial<SessionState>;
			state = {
				tier: saved.tier === "opus" || saved.tier === "sonnet" ? saved.tier : undefined,
				sessionId: typeof saved.sessionId === "string" ? saved.sessionId : undefined,
				syncedContextLength: typeof saved.syncedContextLength === "number" ? saved.syncedContextLength : 0,
			};
		}

		if (event.reason === "new" || event.reason === "fork") state = { syncedContextLength: 0 };
	};

	const requireApiKey = (): string => {
		const key = process.env[API_KEY_ENV_VAR];
		if (!key) {
			throw new Error(
				`${API_KEY_ENV_VAR} is not set. Export the EMSMC company Anthropic API key under this exact ` +
					`variable name before using claude-emsmc/* — this model never falls back to your personal ` +
					"Claude.ai subscription.",
			);
		}
		return key;
	};

	const getSession = (tier: ClaudeTier, effort: ClaudeEffort) => {
		if (!ctx) throw new Error("Claude EMSMC provider has no active Pi session");
		if (session && state.tier && state.tier !== tier) {
			// Model switch mid-conversation (e.g. opus -> sonnet): start a fresh Claude
			// session rather than silently keep talking to the previous tier.
			void resetClaudeMapping(tier);
		}
		if (!session) {
			const apiKey = requireApiKey();
			session = new ClaudeSession({
				cwd: ctx.cwd,
				tier,
				effort,
				apiKey,
				resumeSessionId: state.tier === tier ? state.sessionId : undefined,
				onSessionId(sessionId) {
					state.tier = tier;
					state.sessionId = sessionId;
					persistSessionState();
				},
				onActivity(activity) {
					setStatus(activity);
				},
			});
			state.tier = tier;
		}
		return session;
	};

	const streamSimple = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
		const stream = createAssistantMessageEventStream();
		void (async () => {
			const output: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "pending",
				timestamp: Date.now(),
			};

			try {
				stream.push({ type: "start", partial: output });
				if (!isClaudeTier(model.id)) throw new Error(`Unknown Claude EMSMC tier: ${model.id}`);
				const user = latestUserMessage(context);
				if (!user) throw new Error("Claude EMSMC provider could not find the current user message");
				if (state.syncedContextLength > context.messages.length) await resetClaudeMapping(state.tier);

				const effort = effortFromReasoning(options?.reasoning);
				const claude = getSession(model.id, effort);
				const preceding = context.messages.slice(state.syncedContextLength, -1);
				const external = formatExternalMessages(preceding);
				if (state.sessionId && external) {
					claude.appendContext(
						"Context from Pi turns that occurred outside this Claude session:\n\n" + external,
					);
				}

				const firstSessionSeed = !state.sessionId && context.messages.length > 1
					? formatExternalMessages(context.messages.slice(0, -1))
					: "";
				const prefix = firstSessionSeed
					? "You are taking over an existing Pi conversation. Use this prior context:\n\n" + firstSessionSeed
					: undefined;
				const turn = await claude.send(toClaudeUserMessage(user, prefix), effort, options?.signal);
				if (!turn.text.trim()) throw new Error("Claude CLI returned no final text");

				state.syncedContextLength = context.messages.length + 1;
				persistSessionState();
				output.content.push({ type: "text", text: turn.text });
				output.usage = usageFromResult(turn.result);
				output.stopReason = "stop";
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: turn.text, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: turn.text, partial: output });
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
				setStatus(`Claude EMSMC · ${model.id} ready`);
			} catch (error) {
				const failed = failedMessage(model, error, options?.signal?.aborted ?? false);
				stream.push({ type: "error", reason: failed.stopReason === "aborted" ? "aborted" : "error", error: failed });
				stream.end();
				await closeSession();
				setStatus("Claude EMSMC · error");
			}
		})();
		return stream;
	};

	const tierModel = (tier: ClaudeTier, name: string) => ({
		id: tier,
		name,
		reasoning: true,
		thinkingLevelMap: {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: null,
			max: null,
		},
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 64_000,
	});

	pi.registerProvider("claude-emsmc", {
		name: "Claude EMSMC (company API key)",
		baseUrl: "claude-emsmc://local",
		apiKey: "claude-emsmc-company-key",
		api: "claude-emsmc-agent-sdk",
		models: [
			tierModel("opus", "Opus through Claude CLI (EMSMC)"),
			tierModel("sonnet", "Sonnet through Claude CLI (EMSMC)"),
		],
		streamSimple,
	});

	pi.on("session_start", async (event, current) => reconstruct(event, current));
	pi.on("session_shutdown", async () => closeSession());
	pi.on("session_tree", async () => resetClaudeMapping(state.tier));
	pi.on("session_compact", async () => resetClaudeMapping(state.tier));

	pi.registerCommand("claude-emsmc-status", {
		description: "Show the Claude EMSMC bridge status",
		handler: async (_args, current) => {
			const shortId = state.sessionId ? `${state.sessionId.slice(0, 8)}…` : "not started";
			const keySet = Boolean(process.env[API_KEY_ENV_VAR]);
			current.ui.notify(
				`Claude EMSMC session: ${shortId}\nTier: ${state.tier ?? "not started"}\n` +
					`${API_KEY_ENV_VAR} set: ${keySet ? "yes" : "no"}\nEditor rewrite pass: not present in this provider`,
				"info",
			);
		},
	});
}
