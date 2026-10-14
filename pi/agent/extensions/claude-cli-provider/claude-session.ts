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

export interface ClaudeTurnResult {
	text: string;
	result: SDKResultMessage;
}

export interface ClaudeSessionOptions {
	cwd: string;
	effort: ClaudeEffort;
	model: string;
	configDir: string;
	expectedAccountEmail: string;
	environment?: NodeJS.ProcessEnv;
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

const BLOCKED_ENVIRONMENT_KEYS = new Set([
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"CLAUDE_CONFIG_DIR",
]);

function buildClaudeEnvironment(source: NodeJS.ProcessEnv, configDir: string): NodeJS.ProcessEnv {
	const env = Object.fromEntries(
		Object.entries(source).filter(([key]) => !BLOCKED_ENVIRONMENT_KEYS.has(key.toUpperCase())),
	);
	env.CLAUDE_CONFIG_DIR = configDir;
	return env;
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
	private subscriptionVerification?: Promise<void>;
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

		const env = buildClaudeEnvironment(this.options.environment ?? process.env, this.options.configDir);

		this.nativeQuery = (this.options.queryFactory ?? query)({
			prompt: this.input,
			options: {
				cwd: this.options.cwd,
				pathToClaudeCodeExecutable: claudeBinary,
				model: this.options.model,
				env,
				effort: this.effort,
				permissionMode: "auto",
				disallowedTools: ["AskUserQuestion"],
				includePartialMessages: true,
				persistSession: true,
				abortController: this.abortController,
				...(this.options.resumeSessionId ? { resume: this.options.resumeSessionId } : {}),
				systemPrompt: {
					type: "preset",
					preset: "claude_code",
					append:
						"You are the execution engine inside Pi. Fully solve the user's task. " +
						"Keep every relevant fact, caveat, exact value, command, path, and unresolved question in your final answer.",
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
		if (tool?.type === "tool_use") this.options.onActivity(`Claude CLI · ${tool.name}`);
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
			this.options.onActivity("Claude CLI · ready");
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

	private verifySubscription(): Promise<void> {
		this.subscriptionVerification ??= this.nativeQuery!.accountInfo().then((account) => {
			if (!account.subscriptionType) {
				throw new Error(
					"Claude CLI is not using a Claude.ai subscription. Log in under the configured personal CLAUDE_CONFIG_DIR.",
				);
			}
			if (account.email?.toLowerCase() !== this.options.expectedAccountEmail.toLowerCase()) {
				throw new Error(
					`Claude CLI resolved to ${account.email ?? "an unknown account"}, not the configured personal account. Refusing to continue.`,
				);
			}
		});
		return this.subscriptionVerification;
	}

	private terminatePreflight(): void {
		if (this.closed) return;
		this.closed = true;
		this.input.end();
		this.abortController.abort();
		this.nativeQuery?.close();
	}

	private async awaitPreflight(operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
		if (!signal) {
			await operation();
			return;
		}
		if (signal.aborted) {
			this.terminatePreflight();
			throw new Error("Claude CLI request was aborted");
		}

		let rejectAbort: ((error: Error) => void) | undefined;
		const abortPromise = new Promise<never>((_resolve, reject) => {
			rejectAbort = reject;
		});
		const onAbort = () => {
			this.terminatePreflight();
			rejectAbort?.(new Error("Claude CLI request was aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			await Promise.race([operation(), abortPromise]);
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	}

	private async ensureVerified(signal?: AbortSignal): Promise<void> {
		if (this.closed) throw new Error("Claude CLI session is closed");
		if (signal?.aborted) {
			this.terminatePreflight();
			throw new Error("Claude CLI request was aborted");
		}
		this.ensureStarted();
		await this.awaitPreflight(() => this.verifySubscription(), signal);
	}

	async setEffort(effort: ClaudeEffort): Promise<void> {
		if (this.effort === effort) return;
		this.effort = effort;
		if (this.nativeQuery) await this.nativeQuery.applyFlagSettings({ effortLevel: effort });
	}

	async appendContext(text: string, signal?: AbortSignal): Promise<void> {
		if (!text.trim()) return;
		await this.ensureVerified(signal);
		if (!this.input.push({ role: "user", content: text }, false)) {
			throw new Error("Claude CLI session is closed");
		}
	}

	async send(message: ClaudeMessage, effort: ClaudeEffort, signal?: AbortSignal): Promise<ClaudeTurnResult> {
		if (this.closed) throw new Error("Claude CLI session is closed");
		if (this.pendingTurn) throw new Error("Claude CLI already has an active turn");
		await this.ensureVerified(signal);
		await this.awaitPreflight(() => this.setEffort(effort), signal);
		this.latestAssistantText = "";
		this.options.onActivity("Claude CLI · working");

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
		this.options.onActivity("Claude CLI · interrupting");
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
