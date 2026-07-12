import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	Key,
	decodeKittyPrintable,
	fuzzyMatch,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
} from "@earendil-works/pi-tui";

declare const process: { stdout: { columns?: number; rows?: number } };

type PaletteTab = "All" | "Commands" | "Skills" | "Prompts";
type PaletteCategory = PaletteTab | "Other";

type PaletteCommand = {
	command: any;
	name: string;
	description: string;
	category: PaletteCategory;
};

const TAB_ORDER: PaletteTab[] = ["All", "Commands", "Skills", "Prompts"];
const CATEGORY_ORDER: Record<PaletteCategory, number> = {
	All: 0,
	Commands: 1,
	Skills: 2,
	Prompts: 3,
	Other: 4,
};

export default function commandPaletteExtension(pi: ExtensionAPI): void {
	pi.registerShortcut(Key.ctrl("p"), {
		description: "Open the command palette",
		handler: async (ctx) => {
			await openPalette(pi, ctx);
		},
	});

	pi.registerCommand("palette", {
		description: "Open the command palette",
		handler: async (_args, ctx) => {
			await openPalette(pi, ctx);
		},
	});

	pi.registerCommand("commands", {
		description: "Open the command palette",
		handler: async (_args, ctx) => {
			await openPalette(pi, ctx);
		},
	});
}

async function openPalette(pi: ExtensionAPI, ctx: ExtensionContext): Promise<any | undefined> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Command palette requires the interactive UI.", "warning");
		return undefined;
	}

	const columns = typeof process.stdout.columns === "number" && Number.isFinite(process.stdout.columns) ? process.stdout.columns : 100;
	const rows = typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows) ? process.stdout.rows : 30;
	const overlayWidth = clamp(Math.floor(columns * 0.86), 72, 88);
	const overlayHeight = clamp(Math.floor(rows * 0.72), 14, 19);

	return await ctx.ui.custom<any | undefined>(
		(tui: { requestRender(): void }, theme: any, _keybindings: any, done: (value?: any) => void) => {
			const modal = new CommandPaletteModal(
				() => normalizeCommands(pi.getCommands()),
				ctx,
				theme,
				overlayWidth,
				() => tui.requestRender(),
				(command) => done(command),
			);

			return {
				render: (width: number) => modal.render(width),
				invalidate: () => modal.invalidate(),
				handleInput: (data: string) => modal.handleInput(data),
				focused: true,
			} satisfies Component & Focusable;
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: overlayWidth, minWidth: 64, maxHeight: overlayHeight } },
	);
}

class CommandPaletteModal implements Component, Focusable {
	focused = true;
	private query = "";
	private activeTab: PaletteTab = "All";
	private selectedIndex = 0;

	constructor(
		private readonly getCommands: () => PaletteCommand[],
		private readonly ctx: ExtensionContext,
		private readonly theme: any,
		private readonly modalWidth: number,
		private readonly requestRender: () => void,
		private readonly finish: (command: any | undefined) => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const innerWidth = Math.max(36, Math.min(width, this.modalWidth));
		const commands = this.getCommands();
		const filtered = this.getVisibleCommands(commands);
		this.ensureSelection(filtered.length);

		const visibleRows = this.getVisibleRowsBudget();
		const listRows = Math.min(visibleRows, Math.max(1, filtered.length || 1));
		const windowStart = filtered.length > listRows ? clamp(this.selectedIndex - Math.floor(listRows / 2), 0, filtered.length - listRows) : 0;
		const windowItems = filtered.slice(windowStart, windowStart + listRows);

		const lines: string[] = [];
		lines.push(this.renderTopBorder(this.renderTitleRow(innerWidth), innerWidth));
		lines.push(this.renderBorderedRow(this.renderSearchRow(innerWidth, filtered.length, commands.length), innerWidth));
		lines.push(this.renderBorderedRow(this.renderTabsRow(innerWidth, commands), innerWidth));
		lines.push(this.renderDivider(innerWidth));

		if (filtered.length === 0) {
			lines.push(this.renderBorderedRow(this.renderEmptyRow(innerWidth), innerWidth));
		} else {
			for (let i = 0; i < windowItems.length; i += 1) {
				const item = windowItems[i]!;
				const absoluteIndex = windowStart + i;
				lines.push(this.renderBorderedRow(this.renderCommandRow(item, absoluteIndex === this.selectedIndex, innerWidth), innerWidth));
			}
		}

		const bodyCount = filtered.length === 0 ? 1 : windowItems.length;
		for (let i = bodyCount; i < visibleRows; i += 1) {
			lines.push(this.renderBorderedRow(this.renderBlankRow(innerWidth), innerWidth));
		}

		lines.push(this.renderDivider(innerWidth));
		lines.push(this.renderBorderedRow(this.renderFooterRow(innerWidth, filtered.length, commands.length), innerWidth));
		lines.push(this.renderBottomBorder(innerWidth));
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.finish(undefined);
			return;
		}

		if (matchesKey(data, Key.tab)) {
			this.cycleTab(1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.shift("tab"))) {
			this.cycleTab(-1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.up)) {
			this.moveSelection(-1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.down)) {
			this.moveSelection(1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.pageUp)) {
			this.moveSelection(-(this.getVisibleRowsBudget() - 1));
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.pageDown)) {
			this.moveSelection(this.getVisibleRowsBudget() - 1);
			this.requestRender();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			this.chooseSelected();
			return;
		}

		if (matchesKey(data, Key.backspace)) {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1);
				this.selectedIndex = 0;
				this.requestRender();
			}
			return;
		}

		const printable = this.decodePrintable(data);
		if (printable !== undefined) {
			this.query += printable;
			this.selectedIndex = 0;
			this.requestRender();
		}
	}

	private renderTitleRow(width: number): string {
		const title = this.theme.fg("accent", this.theme.bold("Command Palette"));
		const hint = this.theme.fg("dim", "Ctrl+P /palette");
		return this.centeredRow(width, title, hint);
	}

	private renderSearchRow(width: number, shown: number, total: number): string {
		const label = this.theme.fg("dim", "Search");
		const queryArea = this.query.length > 0
			? this.theme.fg("accent", truncateToWidth(this.query, Math.max(1, width - 24), "…", true))
			: this.theme.fg("dim", "type to search");
		const left = `${label}: ${queryArea}${CURSOR_MARKER}`;
		const right = this.theme.fg("muted", `Showing ${shown}/${total}`);
		return this.padSides(left, right, width);
	}

	private renderTabsRow(width: number, commands: PaletteCommand[]): string {
		const counts = this.countByCategory(commands);
		const tabs = TAB_ORDER.map((tab) => {
			const label = `${tab} ${counts[tab]}`;
			return tab === this.activeTab
				? this.theme.fg("accent", this.theme.bold(`[${label}]`))
				: this.theme.fg("dim", label);
		}).join(this.theme.fg("dim", "  "));
		const other = this.theme.fg("dim", `Other ${counts.Other}`);
		return this.padSides(tabs, other, width);
	}

	private renderFooterRow(width: number, shown: number, total: number): string {
		const left = this.theme.fg("dim", "Tab/Shift+Tab filter  Up/Down move  PgUp/PgDn page  Backspace edit  Enter pick  Esc close");
		const right = this.theme.fg("muted", `${shown}/${total}`);
		return this.padSides(left, right, width);
	}

	private renderCommandRow(item: PaletteCommand, selected: boolean, width: number): string {
		const badgeLabel = this.getBadgeLabel(item.category);
		const badge = this.paintBadge(badgeLabel, item.category, selected);
		const badgeWidth = visibleWidth(`[${badgeLabel}]`);
		const contentWidth = Math.max(0, width - 4);
		const nameMax = Math.min(24, Math.max(8, Math.floor(contentWidth * 0.34)));
		const name = truncateToWidth(item.name, nameMax, "…", true);
		const descBudget = Math.max(0, contentWidth - visibleWidth(name) - badgeWidth - 4);
		const description = item.description ? truncateToWidth(item.description, descBudget, "…", true) : "";
		const leftWidth = 3 + visibleWidth(name) + (description ? 2 + visibleWidth(description) : 0);
		const gap = Math.max(1, width - 2 - leftWidth - badgeWidth);
		const prefix = selected ? ">" : " ";
		const namePaint = selected ? this.theme.fg("accent", this.theme.bold(`/${name}`)) : this.theme.fg("border", `/${name}`);
		const descPaint = description ? `  ${selected ? this.theme.fg("accent", description) : this.theme.fg("muted", description)}` : "";
		const row = `${prefix} ${namePaint}${descPaint}${" ".repeat(gap)}${badge}`;
		return selected ? this.theme.bg("selectedBg", row) : row;
	}

	private renderEmptyRow(width: number): string {
		const text = this.theme.fg("warning", "No matches.");
		const hint = this.theme.fg("dim", "Try a shorter query or switch tabs.");
		return this.padContent(`${text}  ${hint}`, width);
	}

	private renderBlankRow(width: number): string {
		return "".padEnd(width, " ");
	}

	private renderTopBorder(content: string, width: number): string {
		const inner = Math.max(0, width - 2);
		return this.theme.fg("border", `╭${this.padContent(content, inner)}╮`);
	}

	private renderBottomBorder(width: number): string {
		return this.theme.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
	}

	private renderDivider(width: number): string {
		return this.theme.fg("border", `├${"─".repeat(Math.max(0, width - 2))}┤`);
	}

	private renderBorderedRow(content: string, width: number): string {
		const inner = Math.max(0, width - 2);
		return this.theme.fg("border", `│${this.padContent(content, inner)}│`);
	}

	private centeredRow(width: number, left: string, right: string): string {
		const inner = Math.max(0, width - 2);
		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		if (leftWidth + rightWidth + 1 > inner) {
			return this.padContent(`${left} ${right}`, inner);
		}
		const gap = Math.max(1, inner - leftWidth - rightWidth);
		return `${left}${" ".repeat(gap)}${right}`;
	}

	private padSides(left: string, right: string, width: number): string {
		const inner = Math.max(0, width - 2);
		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		if (leftWidth + rightWidth + 1 > inner) {
			return this.padContent(`${left} ${right}`, inner);
		}
		const gap = Math.max(1, inner - leftWidth - rightWidth);
		return `${left}${" ".repeat(gap)}${right}`;
	}

	private padContent(content: string, width: number): string {
		const fitted = truncateToWidth(content, Math.max(0, width), "…", true);
		const padding = Math.max(0, width - visibleWidth(fitted));
		return `${fitted}${" ".repeat(padding)}`;
	}

	private countByCategory(commands: PaletteCommand[]): Record<PaletteCategory, number> {
		const counts: Record<PaletteCategory, number> = { All: commands.length, Commands: 0, Skills: 0, Prompts: 0, Other: 0 };
		for (const command of commands) counts[command.category] += 1;
		return counts;
	}

	private getVisibleCommands(commands: PaletteCommand[]): PaletteCommand[] {
		const query = normalizeQuery(this.query);
		const filtered = commands.filter((command) => this.activeTab === "All" || command.category === this.activeTab);
		if (!query) {
			return filtered.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.name.localeCompare(b.name));
		}

		return filtered
			.map((command) => {
				const target = `${command.name} ${command.description}`.trim();
				const match = fuzzyMatch(query, target);
				return match.matches ? { command, score: match.score } : undefined;
			})
			.filter((value): value is { command: PaletteCommand; score: number } => Boolean(value))
			.sort((a, b) => a.score - b.score || CATEGORY_ORDER[a.command.category] - CATEGORY_ORDER[b.command.category] || a.command.name.localeCompare(b.command.name))
			.map((value) => value.command);
	}

	private ensureSelection(count: number): void {
		if (count <= 0) {
			this.selectedIndex = 0;
			return;
		}
		this.selectedIndex = clamp(this.selectedIndex, 0, count - 1);
	}

	private moveSelection(delta: number): void {
		const count = this.getVisibleCommands(this.getCommands()).length;
		if (count <= 0) return;
		this.selectedIndex = (this.selectedIndex + delta + count) % count;
	}

	private chooseSelected(): void {
		const items = this.getVisibleCommands(this.getCommands());
		const selected = items[this.selectedIndex];
		if (!selected) return;
		this.ctx.ui.setEditorText(`/${selected.name} `);
		this.finish(selected.command);
	}

	private cycleTab(direction: 1 | -1): void {
		const currentIndex = TAB_ORDER.indexOf(this.activeTab);
		const next = (currentIndex + direction + TAB_ORDER.length) % TAB_ORDER.length;
		this.activeTab = TAB_ORDER[next]!;
		this.selectedIndex = 0;
	}

	private getVisibleRowsBudget(): number {
		const rows = typeof process.stdout.rows === "number" && Number.isFinite(process.stdout.rows) ? process.stdout.rows : 30;
		return clamp(Math.floor(rows * 0.33), 6, 12);
	}

	private getBadgeLabel(category: PaletteCategory): string {
		switch (category) {
			case "Commands": return "Cmd";
			case "Skills": return "Skill";
			case "Prompts": return "Prompt";
			default: return "Other";
		}
	}

	private paintBadge(label: string, category: PaletteCategory, selected: boolean): string {
		const body = `[${label}]`;
		return selected
			? this.theme.fg("accent", this.theme.bold(body))
			: category === "Skills"
				? this.theme.fg("success", body)
				: category === "Prompts"
					? this.theme.fg("warning", body)
					: category === "Other"
						? this.theme.fg("dim", body)
						: this.theme.fg("accent", body);
	}

	private decodePrintable(data: string): string | undefined {
		const kitty = decodeKittyPrintable(data);
		if (kitty !== undefined) return kitty;
		if (data.length === 1 && data >= " " && data !== "\u007f") return data;
		if (!data.includes("\u001b") && !/\p{Cc}/u.test(data)) return data;
		return undefined;
	}
}

function normalizeCommands(rawCommands: any[]): PaletteCommand[] {
	const out: PaletteCommand[] = [];
	for (const raw of rawCommands ?? []) {
		const name = String(raw?.name ?? raw?.label ?? raw?.id ?? "").trim();
		if (!name) continue;
		const description = String(raw?.description ?? raw?.summary ?? raw?.details ?? "").trim();
		out.push({
			command: raw,
			name,
			description,
			category: inferCategory(raw),
		});
	}
	return out.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.name.localeCompare(b.name));
}

function inferCategory(command: any): PaletteCategory {
	const sourceText = collectSourceText(command).toLowerCase();
	if (hasPromptSignals(command, sourceText)) return "Prompts";
	if (hasSkillSignals(command, sourceText)) return "Skills";
	if (hasCommandSignals(command, sourceText)) return "Commands";
	return "Other";
}

function hasPromptSignals(command: any, sourceText: string): boolean {
	return Boolean(command?.promptSnippet || command?.promptGuidelines || command?.prompt || sourceText.includes("prompt"));
}

function hasSkillSignals(command: any, sourceText: string): boolean {
	return Boolean(command?.skill || command?.skills || command?.skillName || sourceText.includes("skill"));
}

function hasCommandSignals(command: any, sourceText: string): boolean {
	return Boolean(
		command?.extension
		|| command?.extensionName
		|| command?.extensionId
		|| command?.sourceExtension
		|| command?.source === "extension"
		|| command?.kind === "command"
		|| sourceText.includes("extension")
		|| sourceText.includes("command")
	);
}

function collectSourceText(command: any): string {
	const parts: string[] = [];
	for (const value of [command?.source, command?.kind, command?.type, command?.origin, command?.provider, command?.sourceType]) {
		if (typeof value === "string") parts.push(value);
		else if (value && typeof value === "object") {
			for (const nested of [value.name, value.kind, value.type, value.id]) {
				if (typeof nested === "string") parts.push(nested);
			}
		}
	}
	return parts.join(" ");
}

function normalizeQuery(value: string): string {
	return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
