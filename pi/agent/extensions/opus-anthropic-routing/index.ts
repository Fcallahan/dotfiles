import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const OPUS = "claude-opus-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com";
const SONNET_ROLES = new Set(["scout", "researcher", "evidence-auditor", "delegate", "reviewer", "worker"]);
const SAFE_ACTIONS = new Set(["list", "models", "guide", "status", "children.list", "stop", "interrupt"]);

export function isCompanyOpusSession(model: { provider: string; id: string } | undefined): boolean {
  return model?.provider === "anthropic" && model.id === OPUS;
}

export function delegationBlockReason(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === "run_dynamic_workflow") {
    return "Opus Anthropic-only routing blocks dynamic workflows: their child models cannot be verified before launch. Use a single Sonnet subagent instead.";
  }
  if (toolName !== "subagent") return undefined;
  if (input.workflow || input.workflowScript || input.workflowScriptPath || (input.action && input.task)) {
    return "Opus Anthropic-only routing blocks workflows and mixed management/launch requests.";
  }
  if (typeof input.action === "string" && SAFE_ACTIONS.has(input.action)) return undefined;
  if (input.action || input.runId || input.id) {
    return "Opus Anthropic-only routing blocks workflows, resumes, and unverified subagent actions. Use a single explicit Sonnet child.";
  }
  if (typeof input.agent !== "string" || !SONNET_ROLES.has(input.agent) || typeof input.task !== "string" || !input.task.trim()) {
    return "Opus Anthropic-only routing requires a bounded task for an approved native subagent role.";
  }
  if (input.model !== SONNET) {
    return `Opus Anthropic-only routing requires model: "${SONNET}" on every child launch; inherited or other models are not allowed.`;
  }
  return undefined;
}

export async function companyAnthropicAuthBlockReason(ctx: Pick<ExtensionContext, "modelRegistry">): Promise<string | undefined> {
  const registry = ctx.modelRegistry;
  const provider = registry.getProvider("anthropic");
  const model = registry.find("anthropic", "claude-sonnet-5-5");
  if (!provider || provider.baseUrl !== ANTHROPIC_ENDPOINT || !model || (model.baseUrl && model.baseUrl !== ANTHROPIC_ENDPOINT)) {
    return "Opus Anthropic-only routing could not verify the native Anthropic endpoint and Sonnet 5.5 model.";
  }
  try {
    const auth = await registry.getProviderAuth("anthropic");
    if (registry.isUsingOAuth(model) || auth?.source !== "stored credential" || !auth.auth.apiKey) {
      return "Opus Anthropic-only routing requires the stored Anthropic API-key credential, not OAuth, a proxy, or ambient auth.";
    }
  } catch {
    return "Opus Anthropic-only routing could not verify the Anthropic API-key credential.";
  }
  return undefined;
}

export default function opusAnthropicRouting(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!isCompanyOpusSession(ctx.model)) return;
    const reason = delegationBlockReason(event.toolName, event.input as Record<string, unknown>);
    if (reason) return { block: true, reason };
    if (event.toolName === "subagent" && !(typeof event.input.action === "string" && SAFE_ACTIONS.has(event.input.action))) {
      const authReason = await companyAnthropicAuthBlockReason(ctx);
      if (authReason) return { block: true, reason: authReason };
    }
  });
}
