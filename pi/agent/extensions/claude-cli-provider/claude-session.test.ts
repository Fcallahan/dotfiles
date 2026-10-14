import assert from "node:assert/strict";
import test from "node:test";
import type { Query, SDKMessage, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSession } from "./claude-session.ts";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PERSONAL_EMAIL = "personal@example.com";
const PERSONAL_CONFIG_DIR = "/home/test/.claude-personal";
const FABLE_MODEL = "claude-fable-5-1";
const PERSONAL_SESSION_OPTIONS = {
	model: FABLE_MODEL,
	configDir: PERSONAL_CONFIG_DIR,
	expectedAccountEmail: PERSONAL_EMAIL,
};

class FakeQuery implements AsyncGenerator<SDKMessage, void> {
	private readonly values: SDKMessage[] = [];
	private waiter?: (result: IteratorResult<SDKMessage>) => void;
	closed = false;
	readonly effortChanges: string[] = [];
	interrupted = false;
	subscriptionType: string | undefined = "max";
	email: string | undefined = PERSONAL_EMAIL;
	accountInfoPromise?: Promise<{ subscriptionType?: string; email?: string }>;

	emit(value: SDKMessage): void {
		const waiter = this.waiter;
		if (waiter) {
			this.waiter = undefined;
			waiter({ value, done: false });
		} else this.values.push(value);
	}

	async next(): Promise<IteratorResult<SDKMessage>> {
		const value = this.values.shift();
		if (value) return { value, done: false };
		if (this.closed) return { value: undefined, done: true };
		return new Promise((resolve) => {
			this.waiter = resolve;
		});
	}

	async return(): Promise<IteratorResult<SDKMessage>> {
		this.close();
		return { value: undefined, done: true };
	}

	async throw(error?: unknown): Promise<IteratorResult<SDKMessage>> {
		this.close();
		throw error;
	}

	[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
		return this;
	}

	async interrupt() {
		this.interrupted = true;
		return undefined;
	}

	async applyFlagSettings(settings: { effortLevel?: string | null }) {
		if (settings.effortLevel) this.effortChanges.push(settings.effortLevel);
	}

	async accountInfo() {
		return this.accountInfoPromise ?? { subscriptionType: this.subscriptionType, email: this.email };
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		const waiter = this.waiter;
		this.waiter = undefined;
		waiter?.({ value: undefined, done: true });
	}
}

function success(text: string): SDKResultMessage {
	return {
		type: "result",
		subtype: "success",
		result: text,
		session_id: SESSION_ID,
		usage: { input_tokens: 10, output_tokens: 5 },
		total_cost_usd: 0,
	} as SDKResultMessage;
}

function createHarness() {
	const native = new FakeQuery();
	const received: SDKUserMessage[] = [];
	const calls: Array<{ prompt: string | AsyncIterable<SDKUserMessage>; options?: Record<string, unknown> }> = [];
	let initialized = false;

	const queryFactory = ((params: {
		prompt: string | AsyncIterable<SDKUserMessage>;
		options?: Record<string, unknown>;
	}) => {
		calls.push(params);
		void (async () => {
			if (typeof params.prompt === "string") return;
			for await (const message of params.prompt) {
				received.push(message);
				if (!initialized) {
					initialized = true;
					native.emit({ type: "system", subtype: "init", session_id: SESSION_ID } as SDKMessage);
				}
				if (message.shouldQuery !== false) native.emit(success(`reply ${received.length}`));
			}
		})();
		return native as unknown as Query;
	}) as never;

	return { native, received, calls, queryFactory };
}

test("keeps one Claude query alive across turns and updates effort", async () => {
	const harness = createHarness();
	const sessionIds: string[] = [];
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		onSessionId: (id) => sessionIds.push(id),
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	const first = await session.send({ role: "user", content: "first" }, "high");
	const second = await session.send({ role: "user", content: "second" }, "medium");

	assert.equal(first.text, "reply 1");
	assert.equal(second.text, "reply 2");
	assert.equal(harness.calls.length, 1);
	assert.equal(harness.received.length, 2);
	assert.deepEqual(harness.native.effortChanges, ["medium"]);
	assert.deepEqual(sessionIds, [SESSION_ID]);
	await session.close();
});

test("queues non-query context before the next user turn", async () => {
	const harness = createHarness();
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await session.appendContext("external Pi context");
	const result = await session.send({ role: "user", content: "continue" }, "high");

	assert.equal(result.text, "reply 2");
	assert.equal(harness.received[0]?.shouldQuery, false);
	assert.equal(harness.received[1]?.shouldQuery, true);
	assert.equal(harness.received[0]?.message.content, "external Pi context");
	await session.close();
});

test("rejects API-key sessions instead of silently using API billing", async () => {
	const harness = createHarness();
	harness.native.subscriptionType = undefined;
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "low",
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await assert.rejects(
		session.send({ role: "user", content: "must use subscription" }, "low"),
		/not using a Claude\.ai subscription/,
	);
	await session.close();
});

test("pins Fable 5.1 to the personal config and strips company/API routing", async () => {
	const harness = createHarness();
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		environment: {
			PATH: process.env.PATH,
			Anthropic_Api_Key: "company-api-key",
			anthropic_auth_token: "company-auth-token",
			Anthropic_Base_Url: "https://company.example.test",
			Claude_Config_Dir: "/home/test/.claude-company",
		},
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await session.send({ role: "user", content: "use personal Fable" }, "high");
	const options = harness.calls[0]?.options;
	const env = options?.env as NodeJS.ProcessEnv;
	assert.equal(options?.model, FABLE_MODEL);
	assert.equal(env.CLAUDE_CONFIG_DIR, PERSONAL_CONFIG_DIR);
	const environmentKeys = Object.keys(env).map((key) => key.toUpperCase());
	assert.equal(environmentKeys.filter((key) => key === "CLAUDE_CONFIG_DIR").length, 1);
	assert.equal(environmentKeys.includes("ANTHROPIC_API_KEY"), false);
	assert.equal(environmentKeys.includes("ANTHROPIC_AUTH_TOKEN"), false);
	assert.equal(environmentKeys.includes("ANTHROPIC_BASE_URL"), false);
	await session.close();
});

test("rejects a different subscribed Claude account", async () => {
	const harness = createHarness();
	harness.native.email = "company@example.com";
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await assert.rejects(
		session.send({ role: "user", content: "must use personal account" }, "high"),
		/not the configured personal account/,
	);
	await session.close();
});

test("rejects an unverified account before appending resumed Pi context", async () => {
	const harness = createHarness();
	harness.native.email = "company@example.com";
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await assert.rejects(
		session.appendContext("sensitive resumed context"),
		/not the configured personal account/,
	);
	assert.equal(harness.received.length, 0);
	await session.close();
});

test("aborts and closes the Claude process while account verification is pending", async () => {
	const harness = createHarness();
	harness.native.accountInfoPromise = new Promise(() => undefined);
	const controller = new AbortController();
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "high",
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	const result = session.send({ role: "user", content: "cancel during verification" }, "high", controller.signal);
	controller.abort();
	await assert.rejects(result, /request was aborted/);
	assert.equal(harness.native.closed, true);
	assert.equal(harness.received.length, 0);
});

test("passes a persisted session id to the SDK resume option", async () => {
	const harness = createHarness();
	const session = new ClaudeSession({
		...PERSONAL_SESSION_OPTIONS,
		cwd: process.cwd(),
		effort: "low",
		resumeSessionId: SESSION_ID,
		onSessionId: () => undefined,
		onActivity: () => undefined,
		queryFactory: harness.queryFactory,
	});

	await session.send({ role: "user", content: "resume" }, "low");
	assert.equal(harness.calls[0]?.options?.resume, SESSION_ID);
	await session.close();
});
