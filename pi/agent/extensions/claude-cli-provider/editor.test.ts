import assert from "node:assert/strict";
import test from "node:test";
import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { rewriteClaudeResponse } from "./editor.ts";

const usage: Usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 15,
	cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

const model = { provider: "openai-codex", id: "gpt-5.6-luna" } as Model<Api>;

function response(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function registryWith(result: AssistantMessage | Error): ModelRegistry {
	return {
		find: () => model,
		complete: async () => {
			if (result instanceof Error) throw result;
			return result;
		},
	} as unknown as ModelRegistry;
}

test("uses a valid editor rewrite", async () => {
	const draft = "Run `npm test`; all 42 tests passed.";
	const result = await rewriteClaudeResponse(
		registryWith(response("All 42 tests passed with `npm test`.")),
		draft,
		"Check the tests",
	);

	assert.equal(result.text, "All 42 tests passed with `npm test`.");
	assert.equal(result.fallbackReason, undefined);
	assert.equal(result.usage, usage);
});

test("falls back to Claude text when the editor drops protected content", async () => {
	const draft = "Run `npm test`; all 42 tests passed.";
	const result = await rewriteClaudeResponse(registryWith(response("Tests passed.")), draft, "Check the tests");

	assert.equal(result.text, draft);
	assert.match(result.fallbackReason ?? "", /dropped protected content/);
});

test("falls back when the editor model is unavailable", async () => {
	const registry = { find: () => undefined } as unknown as ModelRegistry;
	const result = await rewriteClaudeResponse(registry, "Original", "Request");
	assert.equal(result.text, "Original");
	assert.match(result.fallbackReason ?? "", /unavailable/);
});

test("falls back when the editor request fails", async () => {
	const result = await rewriteClaudeResponse(registryWith(new Error("network unavailable")), "Original", "Request");
	assert.equal(result.text, "Original");
	assert.match(result.fallbackReason ?? "", /network unavailable/);
});
