import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { loadConfig } from "pi-zentui/extensions/zentui/config";
import { PolishedEditor } from "pi-zentui/extensions/zentui/ui";
import { createModeToggleGuard } from "./mode-toggle.ts";
import { decideShellCommand } from "./utils.ts";

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
  // Track mid-turn mode changes so the context handler can inject a message
  // on the very next LLM call, overriding the stale [PLAN MODE ACTIVE] prompt.
  let midTurnModeChange: Mode | null = null;

  pi.registerFlag("plan", {
    description: "Start in enforced read-only plan mode",
    type: "boolean",
    default: false,
  });

  function persist(): void {
    pi.appendEntry<PersistedState>("plan-build-mode", { mode, toolsBeforePlan });
  }

  function updateUi(ctx: ExtensionContext): void {
    ctx.ui.setStatus("plan-build-mode", undefined);
    const editorFactory = ctx.ui.getEditorComponent();
    if (editorFactory) ctx.ui.setEditorComponent(editorFactory);
  }

  function enterPlan(ctx: ExtensionContext, persistChange = true): void {
    if (mode !== "plan") toolsBeforePlan = pi.getActiveTools();
    mode = "plan";
    pi.setActiveTools((toolsBeforePlan ?? pi.getActiveTools()).filter((name) => READ_ONLY_TOOLS.has(name)));
    midTurnModeChange = "plan";
    updateUi(ctx);
    if (persistChange) persist();
    ctx.ui.notify("Plan mode: read-only tools enforced.", "info");
  }

  function enterBuild(ctx: ExtensionContext, persistChange = true): void {
    mode = "build";
    if (toolsBeforePlan) pi.setActiveTools(toolsBeforePlan);
    toolsBeforePlan = undefined;
    midTurnModeChange = "build";
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

  const shouldToggleMode = createModeToggleGuard();
  const toggleMode = async (ctx: ExtensionContext): Promise<void> => {
    // Legacy terminals report held Shift+Tab as repeated identical escape
    // sequences (or swallow it entirely for backward tab-completion).
    // Ignore the duplicate events so one keypress toggles once.
    if (!shouldToggleMode()) return;
    if (mode === "plan") enterBuild(ctx);
    else enterPlan(ctx);
  };

  pi.registerShortcut(Key.shift("tab"), {
    description: "Toggle plan/build mode",
    handler: toggleMode,
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan/build mode (fallback when Shift+Tab is eaten by terminal)",
    handler: toggleMode,
  });

  pi.on("tool_call", async (event, ctx) => {
    if (mode !== "plan") return;
    if (!READ_ONLY_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Plan mode blocks the ${event.toolName} tool. Run /build to enable mutations.`,
      };
    }
    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      const decision = decideShellCommand(command, ctx.hasUI);
      if (decision.classification === "mutating-or-ambiguous") {
        return {
          block: true,
          reason: `Plan mode blocked a mutating or ambiguous shell command. Run /build first.\nCommand: ${command}`,
        };
      }
      if (decision.action === "block") {
        return {
          block: true,
          reason: `Plan mode could not confirm this unknown shell command in a headless session. Use a known read-only command or run in build mode.\nCommand: ${command}`,
        };
      }
      if (decision.action === "confirm") {
        const allowed = await ctx.ui.confirm(
          "Plan mode: unknown shell command",
          `This command is not recognized as read-only. Run it once?\n\n${command}`,
        );
        if (!allowed) {
          return {
            block: true,
            reason: `Plan mode blocked an unconfirmed shell command. Use a known read-only command or run /build first.\nCommand: ${command}`,
          };
        }
      }
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (mode !== "plan") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n[PLAN MODE ACTIVE]\nYou are in enforced read-only plan mode. Inspect and reason, but do not modify files, install packages, change git state, deploy, or change system state. Ask concise clarifying questions when decisions are unresolved. Return an actionable numbered plan with affected files, risks, and verification steps. The user must run /build before implementation.`,
    };
  });

  // Inject a message into the next LLM call when mode changed mid-turn.
  // This overrides the stale [PLAN MODE ACTIVE] system prompt that was
  // baked into the agent's context at the start of the turn.
  pi.on("context", async (event) => {
    if (!midTurnModeChange) return;
    const change = midTurnModeChange;
    midTurnModeChange = null;

    const message =
      change === "build"
        ? {
            role: "system" as const,
            content:
              "[BUILD MODE]\nPlan mode has been deactivated. You now have full tool access — every tool and command is available. Continue with what you were doing.",
          }
        : {
            role: "system" as const,
            content:
              "[PLAN MODE ACTIVE]\nPlan mode has been activated. You are now in read-only mode. Inspect and reason — do not modify files, install packages, change git state, deploy, or change system state.",
          };

    return { messages: [...event.messages, message] };
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new PolishedEditor(
        tui,
        theme,
        keybindings,
        ctx.ui.theme,
        loadConfig,
        () => {
          const modeLabel = mode === "plan"
            ? ctx.ui.theme.fg("thinkingMedium", "PLAN")
            : ctx.ui.theme.fg("warning", "BUILD");
          const details = ctx.ui.theme.fg(
            "success",
            `⇧Tab/Ctrl+Alt+P  (${ctx.model?.provider ?? "unknown"}) ${ctx.model?.id ?? "no-model"}`,
          );
          return {
            modelLabel: `${modeLabel} ${details}`,
            providerLabel: "",
          };
        },
        () => pi.getThinkingLevel(),
      )
    );

    const saved = ctx.sessionManager.getEntries()
      .filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "plan-build-mode")
      .pop() as { data?: PersistedState } | undefined;

    mode = pi.getFlag("plan") === true ? "plan" : saved?.data?.mode ?? "build";
    toolsBeforePlan = saved?.data?.toolsBeforePlan;
    if (mode === "plan") enterPlan(ctx, false);
    else updateUi(ctx);
  });
}