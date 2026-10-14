import assert from "node:assert/strict";
import test from "node:test";
import opusAnthropicRouting, { companyAnthropicAuthBlockReason, delegationBlockReason, isCompanyOpusSession } from "./index.ts";

const child = { agent: "scout", task: "Map the request path", model: "anthropic/claude-sonnet-5-5" };

test("only the Anthropic Opus 5.5 parent activates the guard", () => {
  assert.equal(isCompanyOpusSession({ provider: "anthropic", id: "claude-opus-5-5" }), true);
  assert.equal(isCompanyOpusSession({ provider: "anthropic", id: "claude-sonnet-5-5" }), false);
  assert.equal(isCompanyOpusSession({ provider: "claude-cli", id: "claude-opus-5-5" }), false);
});

test("permits a bounded Sonnet child and read-only/control actions", () => {
  assert.equal(delegationBlockReason("subagent", child), undefined);
  assert.equal(delegationBlockReason("subagent", { action: "models" }), undefined);
  assert.equal(delegationBlockReason("subagent", { action: "stop", id: "run-1" }), undefined);
  assert.equal(delegationBlockReason("bash", { command: "git status" }), undefined);
});

test("rejects inherited, cross-provider, and non-Sonnet child models", () => {
  for (const model of [undefined, "inherit", "openrouter/deepseek/deepseek-v4-flash", "openai-codex/gpt-5.6-sol", "anthropic/claude-opus-5-5"]) {
    assert.match(delegationBlockReason("subagent", { ...child, model }) ?? "", /requires model/);
  }
});

test("fails closed on unverified orchestration paths and unknown roles", () => {
  for (const input of [
    { workflowScript: "return await runs.run('s',{agent:'scout',task:'x'})" },
    { workflowScriptPath: "workflow.mjs" },
    { workflow: "review", args: { task: "review" } },
    { action: "resume", id: "run-1", message: "continue" },
    { action: "models", workflowScript: "return runs.run('s',{})" },
    { action: "status", ...child },
    { ...child, agent: "claude-code" },
    { ...child, task: " " },
  ]) assert.ok(delegationBlockReason("subagent", input));
  assert.ok(delegationBlockReason("run_dynamic_workflow", { script: "workflow.mjs" }));
});

const registry = (options: { source?: string; key?: string; baseUrl?: string; modelBaseUrl?: string; oauth?: boolean; hasModel?: boolean } = {}) => ({
  getProvider: () => ({ baseUrl: options.baseUrl ?? "https://api.anthropic.com" }),
  find: () => options.hasModel === false ? undefined : ({ baseUrl: options.modelBaseUrl }),
  getProviderAuth: async () => ({ source: options.source ?? "stored credential", auth: { apiKey: options.key === undefined ? "test-key" : options.key } }),
  isUsingOAuth: () => options.oauth ?? false,
});

test("permits the stored Anthropic key on the native endpoint", async () => {
  assert.equal(await companyAnthropicAuthBlockReason({ modelRegistry: registry() } as never), undefined);
});

test("rejects OAuth, environment credentials, missing keys, proxies, and missing model", async () => {
  for (const options of [
    { oauth: true }, { source: "ANTHROPIC_API_KEY" }, { key: "" },
    { baseUrl: "https://proxy.example" }, { modelBaseUrl: "https://proxy.example" }, { hasModel: false },
  ]) assert.ok(await companyAnthropicAuthBlockReason({ modelRegistry: registry(options) } as never));
});

test("fails closed when auth resolution throws", async () => {
  const modelRegistry = { ...registry(), getProviderAuth: async () => { throw new Error("auth unavailable"); } };
  assert.match(await companyAnthropicAuthBlockReason({ modelRegistry } as never) ?? "", /could not verify/);
});

test("tool hook checks active parent and credential before dispatch", async () => {
  let handler: ((event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<{ block: true; reason: string } | undefined>) | undefined;
  opusAnthropicRouting({ on: (_name: string, callback: typeof handler) => { handler = callback; } } as never);
  assert.ok(handler);
  const request = { toolName: "subagent", input: child };
  const opus = { model: { provider: "anthropic", id: "claude-opus-5-5" }, modelRegistry: registry() };
  assert.equal(await handler(request, opus), undefined);
  assert.equal((await handler(request, { ...opus, modelRegistry: registry({ oauth: true }) }))?.block, true);
  assert.equal((await handler({ ...request, input: { ...child, model: "openrouter/deepseek/deepseek-v4-flash" } }, opus))?.block, true);
  assert.equal(await handler(request, { ...opus, model: { provider: "openrouter", id: "deepseek-v4-flash" } }), undefined);
});
