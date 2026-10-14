import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { describeBackgroundTasks, formatTaskDuration, scanBackgroundTasks } from "./background-tasks.ts";
import { ClaudeSession, type ClaudeEffort, type ClaudeMessage } from "./claude-session.ts";
import { rewriteClaudeResponse } from "./editor.ts";

const SESSION_ENTRY = "claude-cli-provider-session-v1";
const EDITOR_ENTRY = "claude-cli-provider-editor-v1";
const STATUS_ID = "claude-cli-provider";
const BG_TASKS_STATUS_ID = "claude-cli-provider-bg-tasks";
const BG_TASKS_POLL_MS = 2_000;
const PERSONAL_CLAUDE_CONFIG_DIR = join(homedir(), ".claude-personal");
const PERSONAL_CLAUDE_EMAIL = "franciscallahan44@gmail.com";
const FABLE_MODEL_ID = "claude-fable-5-1";

interface SessionState {
	sessionId?: string;
	syncedContextLength: number;
}

interface EditorState {
	enabled: boolean;
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

function combinedUsage(result: { usage: unknown }, editorUsage?: Usage): Usage {
	const raw = result.usage as Record<string, unknown>;
	const input = numberValue(raw.input_tokens) + (editorUsage?.input ?? 0);
	const output = numberValue(raw.output_tokens) + (editorUsage?.output ?? 0);
	const cacheRead = numberValue(raw.cache_read_input_tokens) + (editorUsage?.cacheRead ?? 0);
	const cacheWrite = numberValue(raw.cache_creation_input_tokens) + (editorUsage?.cacheWrite ?? 0);
	const editorCost = editorUsage?.cost.total ?? 0;

	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: {
			input: editorUsage?.cost.input ?? 0,
			output: editorUsage?.cost.output ?? 0,
			cacheRead: editorUsage?.cost.cacheRead ?? 0,
			cacheWrite: editorUsage?.cost.cacheWrite ?? 0,
			total: editorCost,
		},
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

export default function claudeCliProvider(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let registry: ModelRegistry | undefined;
	let session: ClaudeSession | undefined;
	let state: SessionState = { syncedContextLength: 0 };
	let editor: EditorState = { enabled: true };
	let lastFallbackReason: string | undefined;

	const setStatus = (text?: string) => ctx?.ui.setStatus(STATUS_ID, text);

	const persistSessionState = () => pi.appendEntry(SESSION_ENTRY, { ...state });
	const persistEditorState = () => pi.appendEntry(EDITOR_ENTRY, { ...editor });

	const closeSession = async () => {
		const current = session;
		session = undefined;
		await current?.close();
		setStatus();
	};

	let bgTasksTimer: ReturnType<typeof setInterval> | undefined;

	const updateBackgroundTasksStatus = () => {
		if (!ctx?.hasUI || !state.sessionId) {
			ctx?.ui.setStatus(BG_TASKS_STATUS_ID, undefined);
			return;
		}
		const tasks = scanBackgroundTasks({ cwd: ctx.cwd, sessionId: state.sessionId });
		const description = describeBackgroundTasks(tasks);
		ctx.ui.setStatus(BG_TASKS_STATUS_ID, description ? ctx.ui.theme.fg("accent", description) : undefined);
	};

	const startBackgroundTasksPoller = () => {
		if (bgTasksTimer) return;
		bgTasksTimer = setInterval(updateBackgroundTasksStatus, BG_TASKS_POLL_MS);
		bgTasksTimer.unref?.();
	};

	const stopBackgroundTasksPoller = () => {
		if (!bgTasksTimer) return;
		clearInterval(bgTasksTimer);
		bgTasksTimer = undefined;
		ctx?.ui.setStatus(BG_TASKS_STATUS_ID, undefined);
	};

	const resetClaudeMapping = async () => {
		await closeSession();
		state = { syncedContextLength: 0 };
		persistSessionState();
	};

	const reconstruct = (event: { reason: string }, current: ExtensionContext) => {
		ctx = current;
		registry = current.modelRegistry;
		state = { syncedContextLength: 0 };
		editor = { enabled: true };
		lastFallbackReason = undefined;

		for (const entry of current.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === SESSION_ENTRY && entry.data && typeof entry.data === "object") {
				const saved = entry.data as Partial<SessionState>;
				state = {
					sessionId: typeof saved.sessionId === "string" ? saved.sessionId : undefined,
					syncedContextLength:
						typeof saved.syncedContextLength === "number" ? saved.syncedContextLength : 0,
				};
			} else if (entry.customType === EDITOR_ENTRY && entry.data && typeof entry.data === "object") {
				const saved = entry.data as Partial<EditorState>;
				if (typeof saved.enabled === "boolean") editor = { enabled: saved.enabled };
			}
		}

		if (event.reason === "new" || event.reason === "fork") state = { syncedContextLength: 0 };
	};

	const getSession = (effort: ClaudeEffort) => {
		if (!ctx) throw new Error("Claude CLI provider has no active Pi session");
		if (!session) {
			session = new ClaudeSession({
				cwd: ctx.cwd,
				effort,
				model: FABLE_MODEL_ID,
				configDir: PERSONAL_CLAUDE_CONFIG_DIR,
				expectedAccountEmail: PERSONAL_CLAUDE_EMAIL,
				resumeSessionId: state.sessionId,
				onSessionId(sessionId) {
					state.sessionId = sessionId;
					persistSessionState();
				},
				onActivity(activity) {
					setStatus(activity);
				},
			});
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
				const user = latestUserMessage(context);
				if (!user) throw new Error("Claude CLI provider could not find the current user message");
				if (state.syncedContextLength > context.messages.length) await resetClaudeMapping();

				const effort = effortFromReasoning(options?.reasoning);
				const claude = getSession(effort);
				const preceding = context.messages.slice(state.syncedContextLength, -1);
				const external = formatExternalMessages(preceding);
				if (state.sessionId && external) {
					await claude.appendContext(
						"Context from Pi turns that occurred outside this Claude session:\n\n" + external,
						options?.signal,
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

				let finalText = turn.text;
				let editorUsage: Usage | undefined;
				lastFallbackReason = undefined;
				if (editor.enabled) {
					if (!registry) throw new Error("Pi model registry is unavailable for editor rewriting");
					setStatus("Luna · editing");
					const rewritten = await rewriteClaudeResponse(registry, turn.text, userText(user), options?.signal);
					finalText = rewritten.text;
					editorUsage = rewritten.usage;
					lastFallbackReason = rewritten.fallbackReason;
				}

				if (editor.enabled && finalText !== turn.text) {
					await claude.appendContext(
						"Pi displayed this editorially rewritten version of your answer. Treat its meaning as your delivered answer:\n\n" +
							finalText,
						options?.signal,
					);
				}

				state.syncedContextLength = context.messages.length + 1;
				persistSessionState();
				output.content.push({ type: "text", text: finalText });
				output.usage = combinedUsage(turn.result, editorUsage);
				output.stopReason = "stop";
				stream.push({ type: "text_start", contentIndex: 0, partial: output });
				stream.push({ type: "text_delta", contentIndex: 0, delta: finalText, partial: output });
				stream.push({ type: "text_end", contentIndex: 0, content: finalText, partial: output });
				stream.push({ type: "done", reason: "stop", message: output });
				stream.end();
				setStatus(lastFallbackReason ? "Claude CLI · raw fallback" : "Claude CLI · ready");
			} catch (error) {
				const failed = failedMessage(model, error, options?.signal?.aborted ?? false);
				stream.push({ type: "error", reason: failed.stopReason === "aborted" ? "aborted" : "error", error: failed });
				stream.end();
				await closeSession();
				setStatus("Claude CLI · error");
			}
		})();
		return stream;
	};

	pi.registerProvider("claude-cli", {
		name: "Claude CLI",
		baseUrl: "claude-cli://local",
		apiKey: "claude-cli-subscription",
		api: "claude-cli-agent-sdk",
		models: [
			{
				id: "fable-5.1",
				name: "Fable 5.1 through personal Claude CLI",
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
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 64_000,
			},
		],
		streamSimple,
	});

	pi.on("session_start", async (event, current) => {
		reconstruct(event, current);
		startBackgroundTasksPoller();
	});
	pi.on("session_shutdown", async () => {
		stopBackgroundTasksPoller();
		await closeSession();
	});
	pi.on("session_tree", async () => resetClaudeMapping());
	pi.on("session_compact", async () => resetClaudeMapping());

	pi.registerCommand("claude-editor", {
		description: "Enable or disable Luna final-response editing: /claude-editor on|off",
		handler: async (args, current) => {
			const value = args.trim().toLowerCase();
			if (value !== "on" && value !== "off") {
				current.ui.notify(`Luna editor is ${editor.enabled ? "on" : "off"}`, "info");
				return;
			}
			editor = { enabled: value === "on" };
			persistEditorState();
			current.ui.notify(`Luna editor ${value}`, "info");
		},
	});

	pi.registerCommand("claude-status", {
		description: "Show the Claude CLI bridge status",
		handler: async (_args, current) => {
			const shortId = state.sessionId ? `${state.sessionId.slice(0, 8)}…` : "not started";
			const fallback = lastFallbackReason ? `\nLast editor fallback: ${lastFallbackReason}` : "";
			current.ui.notify(
				`Claude session: ${shortId}\nLuna editor: ${editor.enabled ? "on" : "off"}${fallback}`,
				"info",
			);
		},
	});

	pi.registerCommand("claude-tasks", {
		description: "Best-effort list of the Claude Agent SDK's own background Task tool calls for this session",
		handler: async (_args, current) => {
			if (!state.sessionId) {
				current.ui.notify("No Claude CLI session started yet.", "info");
				return;
			}
			const tasks = scanBackgroundTasks({ cwd: current.cwd, sessionId: state.sessionId });
			if (tasks.length === 0) {
				current.ui.notify("No Claude background tasks found (or the transcript directory layout changed).", "info");
				return;
			}
			const now = Date.now();
			const lines = tasks.map((task) => {
				const elapsed = task.startedAt !== undefined ? formatTaskDuration(Math.max(0, now - task.startedAt)) : "?";
				const staleness = task.active ? "active" : `idle ${formatTaskDuration(now - task.lastActivityAt)}`;
				return `${task.id} [${staleness}] ${task.label} · ${elapsed}\n  task: ${task.taskPreview}\n  output: ${task.outputPath}`;
			});
			current.ui.notify(
				`${lines.join("\n\n")}\n\n(Liveness is inferred from file modification time; there is no authoritative completion signal for these SDK-internal tasks.)`,
				"info",
			);
		},
	});
}
