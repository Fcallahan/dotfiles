export const progressStatuses = ["pending", "in_progress", "completed", "cancelled"] as const;

export type ProgressStatus = (typeof progressStatuses)[number];

export interface ProgressItem {
	content: string;
	status: ProgressStatus;
}

export function validateProgress(items: readonly ProgressItem[]): string | undefined {
	if (items.length < 3) return "Progress tracking requires at least three meaningful phases";
	if (items.length > 10) return "Progress tracking supports at most ten phases";

	const names = new Set<string>();
	for (const item of items) {
		const content = item.content.trim();
		if (!content) return "Progress item content cannot be empty";
		if (names.has(content)) return `Duplicate progress item: ${content}`;
		names.add(content);
	}

	const active = items.filter((item) => item.status === "in_progress").length;
	const unfinished = items.some((item) => item.status === "pending" || item.status === "in_progress");
	if (unfinished && active !== 1) return "Exactly one item must be in progress while work remains";
	if (!unfinished && active !== 0) return "Finished progress lists cannot contain an active item";

	return undefined;
}

export function cloneProgress(items: readonly ProgressItem[]): ProgressItem[] {
	return items.map((item) => ({ content: item.content.trim(), status: item.status }));
}

export function progressCounts(items: readonly ProgressItem[]) {
	return {
		completed: items.filter((item) => item.status === "completed").length,
		total: items.length,
	};
}
