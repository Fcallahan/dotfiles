import * as fs from "node:fs";
import * as path from "node:path";
import {
	query,
	type Query,
	type SDKAssistantMessage,
	type SDKMessage,
	type SDKResultMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type ClaudeEffort = "low" | "medium" | "high";
export type ClaudeMessage = SDKUserMessage["message"];
export type ClaudeTier = "opus" | "sonnet";

export interface ClaudeTurnResult {
	text: string;
	result: SDKResultMessage;
}

export interface ClaudeSessionOptions {
	cwd: string;
	tier: ClaudeTier;
	effort: ClaudeEffort;
	apiKey: string;
	resumeSessionId?: string;
	onSessionId(sessionId: string): void;
	onActivity(activity: string): void;
	queryFactory?: typeof query;
}

interface PendingTurn {
	resolve(value: ClaudeTurnResult): void;
	reject(error: Error): void;
	cleanupAbort?: () => void;
}

class ClaudeInput implements AsyncIterable<SDKUserMessage> {
	private readonly pending: SDKUserMessage[] = [];
	private waiter?: (result: IteratorResult<SDKUserMessage>) => void;
	private closed = false;

	push(message: ClaudeMessage, shouldQuery = true): boolean {
		if (this.closed) return false;
		const value: SDKUserMessage = {
			type: "user",
			message,
			parent_tool_use_id: null,
			shouldQuery,
			uuid: crypto.randomUUID(),
		};
		const waiter = this.waiter;
		if (waiter) {
			this.waiter = undefined;
			waiter({ value, done: false });
		} else {
			this.pending.push(value);
		}
		return true;
	}

	end(): void {
		if (this.closed) return;
		this.closed = true;
		const waiter = this.waiter;
		this.waiter = undefined;
		waiter?.({ value: undefined, done: true });
	}

	async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		while (!this.closed) {
			const queued = this.pending.shift();
			if (queued) {
				yield queued;
				continue;
			}
			const next = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
				this.waiter = resolve;
			});
			if (next.done) return;
			yield next.value;
		}
	}
}

function resolveClaudeBinary(): string | undefined {
	const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!directory) continue;
		for (const name of names) {
			const candidate = path.join(directory, name);
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				// Keep searching PATH.
			}
		}
	}
	return undefined;
}

function errorText(result: SDKResultMessage): string {
	if (result.subtype === "success") return "";
	return result.errors.filter(Boolean).join("\n") || result.stop_reason || `Claude ended with ${result.subtype}`;
}

async function waitAtMost(operation: Promise<unknown> | undefined, timeoutMs: number): Promise<void> {
	if (!operation) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		operation.catch(() => undefined),
		new Promise<void>((resolve) => {
			timer = setTimeout(resolve, timeoutMs);
		}),
	]);
	if (timer) clearTimeout(timer);
}

/**
 * Isolated from claude-cli-provider's ClaudeSession on purpose: this one authenticates
 * every subprocess with an explicit EMSMC API key (never the ambient `claude auth login`
 * subscription) and verifies that on every turn, so a missing/invalid company key fails
 * loudly instead of silently falling back to the personal Claude.ai subscription.
 */
export class ClaudeSession {
	private readonly input = new ClaudeInput();
	private readonly abortController = new AbortController();
	private nativeQuery?: Query;
	private pump?: Promise<void>;
	private pendingTurn?: PendingTurn;
	private latestAssistantText = "";
	private closed = false;
	private effort: ClaudeEffort;
	private sessionId?: string;
	private apiKeyVerification?: Promise<void>;
	private readonly options: ClaudeSessionOptions;

	constructor(options: ClaudeSessionOptions) {
		this.options = options;
		this.effort = options.effort;
		this.sessionId = options.resumeSessionId;
	}

	get nativeSessionId(): string | undefined {
		return this.sessionId;
	}

	private ensureStarted(): void {
		if (this.nativeQuery) return;
		const claudeBinary = resolveClaudeBinary();
		if (!claudeBinary) throw new Error("Claude CLI is not available on PATH");

		this.nativeQuery = (this.options.queryFactory ?? query)({
			prompt: this.input,
			options: {
				cwd: this.options.cwd,
				pathToClaudeCodeExecutable: claudeBinary,
				model: this.options.tier,
				effort: this.effort,
				permissionMode: "auto",
				disallowedTools: ["AskUserQuestion"],
				includePartialMessages: true,
				persistSession: true,
				abortController: this.abortController,
				// SDK note: this REPLACES the subprocess env entirely (not merged with
				// process.env), which is exactly what we want here — it guarantees this
				// subprocess never inherits an ambient ANTHROPIC_API_KEY or falls back to
				// a `claude auth login` subscription session from elsewhere in Pi.
				env: { ...process.env, ANTHROPIC_API_KEY: this.options.apiKey },
				...(this.options.resumeSessionId ? { resume: this.options.resumeSessionId } : {}),
				systemPrompt: {
					type: "preset",
					preset: "claude_code",
					append:
						"You are the execution engine inside Pi, running on the EMSMC company Anthropic account. " +
						"Fully solve the user's task. Keep every relevant fact, caveat, exact value, command, path, " +
						"and unresolved question in your final answer.",
				},
			},
		});
		this.pump = this.pumpMessages();
	}

	private updateSessionId(sessionId: string): void {
		if (!sessionId || sessionId === this.sessionId) return;
		this.sessionId = sessionId;
		this.options.onSessionId(sessionId);
	}

	private handleAssistant(message: SDKAssistantMessage): void {
		if (message.parent_tool_use_id !== null) return;
		const text = message.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();
		if (text) this.latestAssistantText = text;

		const tool = message.message.content.find((block) => block.type === "tool_use");
		if (tool?.type === "tool_use") this.options.onActivity(`Claude EMSMC · ${tool.name}`);
	}

	private settle(result: SDKResultMessage): void {
		this.updateSessionId(result.session_id);
		const pending = this.pendingTurn;
		if (!pending) return;
		this.pendingTurn = undefined;
		pending.cleanupAbort?.();

		if (result.subtype !== "success") {
			pending.reject(new Error(errorText(result)));
			return;
		}
		pending.resolve({ text: result.result.trim() || this.latestAssistantText, result });
	}

	private handleMessage(message: SDKMessage): void {
		if (message.type === "system" && message.subtype === "init") {
			this.updateSessionId(message.session_id);
			this.options.onActivity("Claude EMSMC · ready");
		} else if (message.type === "assistant") {
			this.handleAssistant(message);
		} else if (message.type === "result") {
			this.settle(message);
		}
	}

	private async pumpMessages(): Promise<void> {
		try {
			for await (const message of this.nativeQuery!) this.handleMessage(message);
			if (!this.closed) throw new Error("Claude CLI session ended unexpectedly");
		} catch (error) {
			if (this.closed) return;
			this.closed = true;
			const pending = this.pendingTurn;
			this.pendingTurn = undefined;
			pending?.cleanupAbort?.();
			pending?.reject(error instanceof Error ? error : new Error(String(error)));
		}
	}

	/**
	 * Inverse of claude-cli-provider's subscription check: this bridge must NEVER
	 * resolve to the personal Claude.ai subscription. If it does, the EMSMC API key
	 * env override failed to take effect and we abort rather than risk running
	 * company work — or worse, company work billed/attributed to the wrong account.
	 */
	private verifyApiKeyAuth(): Promise<void> {
		this.apiKeyVerification ??= this.nativeQuery!.accountInfo().then((account) => {
			if (account.subscriptionType) {
				throw new Error(
					"Claude CLI resolved to a Claude.ai subscription instead of the EMSMC API key. " +
						"Refusing to continue — check that EMSMC_ANTHROPIC_API_KEY is set and valid.",
				);
			}
		});
		return this.apiKeyVerification;
	}

	async setEffort(effort: ClaudeEffort): Promise<void> {
		if (this.effort === effort) return;
		this.effort = effort;
		if (this.nativeQuery) await this.nativeQuery.applyFlagSettings({ effortLevel: effort });
	}

	appendContext(text: string): void {
		if (!text.trim()) return;
		this.ensureStarted();
		if (!this.input.push({ role: "user", content: text }, false)) {
			throw new Error("Claude CLI session is closed");
		}
	}

	async send(message: ClaudeMessage, effort: ClaudeEffort, signal?: AbortSignal): Promise<ClaudeTurnResult> {
		if (this.closed) throw new Error("Claude CLI session is closed");
		if (this.pendingTurn) throw new Error("Claude CLI already has an active turn");
		this.ensureStarted();
		await this.verifyApiKeyAuth();
		await this.setEffort(effort);
		this.latestAssistantText = "";
		this.options.onActivity("Claude EMSMC · working");

		return new Promise<ClaudeTurnResult>((resolve, reject) => {
			const onAbort = () => void this.interrupt();
			if (signal?.aborted) {
				reject(new Error("Claude CLI request was aborted"));
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pendingTurn = {
				resolve,
				reject,
				cleanupAbort: () => signal?.removeEventListener("abort", onAbort),
			};

			if (!this.input.push(message)) {
				this.pendingTurn = undefined;
				signal?.removeEventListener("abort", onAbort);
				reject(new Error("Claude CLI session is closed"));
			}
		});
	}

	async interrupt(): Promise<void> {
		if (!this.nativeQuery || !this.pendingTurn) return;
		this.options.onActivity("Claude EMSMC · interrupting");
		try {
			await this.nativeQuery.interrupt();
		} catch {
			// The pump reports the authoritative terminal result.
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.input.end();
		this.abortController.abort();
		this.nativeQuery?.close();
		const pending = this.pendingTurn;
		this.pendingTurn = undefined;
		pending?.cleanupAbort?.();
		pending?.reject(new Error("Claude CLI session closed"));
		await waitAtMost(this.pump, 2_000);
	}
}
