import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	cloneProgress,
	progressCounts,
	progressStatuses,
	validateProgress,
	type ProgressItem,
	type ProgressStatus,
} from "./state.ts";

const ENTRY_TYPE = "structured-progress-state";
const WIDGET_ID = "structured-progress";

interface ProgressDetails {
	action: "set" | "clear";
	items: ProgressItem[];
	error?: string;
}

const ProgressItemSchema = Type.Object({
	content: Type.String({ description: "A specific, actionable phase" }),
	status: StringEnum([...progressStatuses]),
});

const ProgressParams = Type.Object({
	action: StringEnum(["set", "clear"] as const),
	items: Type.Optional(Type.Array(ProgressItemSchema, { minItems: 3, maxItems: 10 })),
});

function indicator(status: ProgressStatus): string {
	switch (status) {
		case "completed": return "[✓]";
		case "in_progress": return "[•]";
		case "cancelled": return "[-]";
		default: return "[ ]";
	}
}

function themedLine(item: ProgressItem, theme: Theme): string {
	const line = `${indicator(item.status)} ${item.content}`;
	if (item.status === "completed" || item.status === "cancelled") return theme.fg("dim", line);
	if (item.status === "in_progress") return theme.fg("accent", line);
	return theme.fg("muted", line);
}

function plainList(items: readonly ProgressItem[]): string {
	return items.map((item) => `${indicator(item.status)} ${item.content}`).join("\n");
}

function isProgressSnapshot(data: unknown): data is { items: ProgressItem[] } {
	if (!data || typeof data !== "object" || !("items" in data)) return false;
	const items = (data as { items?: unknown }).items;
	return Array.isArray(items);
}

export default function progress(pi: ExtensionAPI) {
	let items: ProgressItem[] = [];

	function updateWidget(ctx: ExtensionContext) {
		if (items.length === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
			render(width: number) {
				const counts = progressCounts(items);
				return [
					truncateToWidth(theme.fg("toolTitle", theme.bold(`Progress ${counts.completed}/${counts.total}`)), width),
					...items.map((item) => truncateToWidth(themedLine(item, theme), width)),
				];
			},
			invalidate() {},
		}));
	}

	function save(next: readonly ProgressItem[], ctx: ExtensionContext) {
		items = cloneProgress(next);
		pi.appendEntry(ENTRY_TYPE, { items });
		updateWidget(ctx);
	}

	function reconstruct(ctx: ExtensionContext) {
		items = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE && isProgressSnapshot(entry.data)) {
				items = cloneProgress(entry.data.items);
			}
		}
		updateWidget(ctx);
	}

	pi.on("session_start", async (_event, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstruct(ctx));

	pi.registerTool({
		name: "progress",
		label: "Progress",
		description:
			"Create or update visible progress for substantial work with at least three meaningful phases. " +
			"Do not use for simple edits, questions, or conversational requests. Keep exactly one item in_progress while work remains, " +
			"update at phase boundaries, and mark completed only after the phase and its required verification are done.",
		parameters: ProgressParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.action === "clear") {
				save([], ctx);
				return {
					content: [{ type: "text" as const, text: "Progress cleared" }],
					details: { action: "clear", items: [] } as ProgressDetails,
				};
			}

			if (!params.items) {
				const error = "items are required when action is set";
				return {
					content: [{ type: "text" as const, text: `Error: ${error}` }],
					details: { action: "set", items, error } as ProgressDetails,
					isError: true,
				};
			}

			const next = params.items as ProgressItem[];
			const error = validateProgress(next);
			if (error) {
				return {
					content: [{ type: "text" as const, text: `Error: ${error}` }],
					details: { action: "set", items, error } as ProgressDetails,
					isError: true,
				};
			}

			save(next, ctx);
			return {
				content: [{ type: "text" as const, text: plainList(items) }],
				details: { action: "set", items } as ProgressDetails,
			};
		},

		renderCall(args, theme) {
			const suffix = args.action === "set" && args.items ? ` ${args.items.length} phases` : "";
			return new Text(theme.fg("toolTitle", theme.bold("progress ")) + theme.fg("muted", args.action + suffix), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as ProgressDetails | undefined;
			if (!details) return new Text("", 0, 0);
			if (details.error) return new Text(theme.fg("error", details.error), 0, 0);
			if (details.action === "clear") return new Text(theme.fg("success", "✓ Progress cleared"), 0, 0);

			const visible = expanded ? details.items : details.items.slice(0, 5);
			let text = visible.map((item) => themedLine(item, theme)).join("\n");
			if (!expanded && details.items.length > visible.length) {
				text += `\n${theme.fg("dim", `… ${details.items.length - visible.length} more`)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	pi.registerCommand("progress", {
		description: "Show the current structured progress list",
		handler: async (_args, ctx) => {
			updateWidget(ctx);
			if (items.length === 0) ctx.ui.notify("No active progress list", "info");
			else {
				const counts = progressCounts(items);
				ctx.ui.notify(`Progress: ${counts.completed}/${counts.total} completed`, "info");
			}
		},
	});

	pi.registerCommand("progress-clear", {
		description: "Clear the current structured progress list",
		handler: async (_args, ctx) => {
			save([], ctx);
			ctx.ui.notify("Progress cleared", "info");
		},
	});
}
