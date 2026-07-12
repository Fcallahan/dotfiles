import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { isReadOnlyCommand } from "./utils.ts";

type Mode = "plan" | "build";

interface PersistedState {
  mode: Mode;
  toolsBeforePlan?: string[];
}

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "questionnaire",
]);

export default function planBuildExtension(pi: ExtensionAPI): void {
  let mode: Mode = "build";
  let toolsBeforePlan: string[] | undefined;

  pi.registerFlag("plan", {
    description: "Start in enforced read-only plan mode",
    type: "boolean",
    default: false,
  });

  function persist(): void {
    pi.appendEntry<PersistedState>("plan-build-mode", { mode, toolsBeforePlan });
  }

  function updateUi(ctx: ExtensionContext): void {
    const label = mode === "plan" ? "PLAN" : "BUILD";
    const color: "warning" | "success" = mode === "plan" ? "warning" : "success";
    ctx.ui.setStatus(
      "plan-build-mode",
      ctx.ui.theme.fg(color, `${label} ⇧Tab`),
    );
  }

  function enterPlan(ctx: ExtensionContext, persistChange = true): void {
    if (mode !== "plan") toolsBeforePlan = pi.getActiveTools();
    mode = "plan";
    pi.setActiveTools((toolsBeforePlan ?? pi.getActiveTools()).filter((name) => READ_ONLY_TOOLS.has(name)));
    updateUi(ctx);
    if (persistChange) persist();
    ctx.ui.notify("Plan mode: read-only tools enforced.", "info");
  }

  function enterBuild(ctx: ExtensionContext, persistChange = true): void {
    mode = "build";
    if (toolsBeforePlan) pi.setActiveTools(toolsBeforePlan);
    toolsBeforePlan = undefined;
    updateUi(ctx);
    if (persistChange) persist();
    ctx.ui.notify("Build mode: full tool access restored.", "info");
  }

  pi.registerCommand("plan", {
    description: "Enter enforced read-only plan mode",
    handler: async (_args, ctx) => enterPlan(ctx),
  });

  pi.registerCommand("build", {
    description: "Enter build mode with full tool access",
    handler: async (_args, ctx) => enterBuild(ctx),
  });

  pi.registerCommand("mode", {
    description: "Show or set mode: /mode [plan|build]",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (!requested) {
        ctx.ui.notify(`Current mode: ${mode}`, "info");
      } else if (requested === "plan") {
        enterPlan(ctx);
      } else if (requested === "build") {
        enterBuild(ctx);
      } else {
        ctx.ui.notify("Usage: /mode [plan|build]", "warning");
      }
    },
  });

  const toggleMode = async (ctx: ExtensionContext): Promise<void> => {
    if (mode === "plan") enterBuild(ctx);
    else enterPlan(ctx);
  };

  pi.registerShortcut(Key.shift("tab"), {
    description: "Toggle plan/build mode",
    handler: toggleMode,
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan/build mode",
    handler: toggleMode,
  });

  pi.on("tool_call", async (event) => {
    if (mode !== "plan") return;
    if (!READ_ONLY_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Plan mode blocks the ${event.toolName} tool. Run /build to enable mutations.`,
      };
    }
    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      if (!isReadOnlyCommand(command)) {
        return {
          block: true,
          reason: `Plan mode blocked a non-allowlisted shell command. Run /build first.\nCommand: ${command}`,
        };
      }
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (mode !== "plan") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n[PLAN MODE ACTIVE]\nYou are in enforced read-only plan mode. Inspect and reason, but do not modify files, install packages, change git state, deploy, or change system state. Ask concise clarifying questions when decisions are unresolved. Return an actionable numbered plan with affected files, risks, and verification steps. The user must run /build before implementation.`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    const saved = ctx.sessionManager.getEntries()
      .filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "plan-build-mode")
      .pop() as { data?: PersistedState } | undefined;

    mode = pi.getFlag("plan") === true ? "plan" : saved?.data?.mode ?? "build";
    toolsBeforePlan = saved?.data?.toolsBeforePlan;
    if (mode === "plan") enterPlan(ctx, false);
    else updateUi(ctx);
  });
}
