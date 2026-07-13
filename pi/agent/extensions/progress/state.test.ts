import assert from "node:assert/strict";
import test from "node:test";
import { cloneProgress, progressCounts, validateProgress, type ProgressItem } from "./state.ts";

const valid: ProgressItem[] = [
	{ content: "Inspect the current behavior", status: "completed" },
	{ content: "Implement the focused change", status: "in_progress" },
	{ content: "Run verification", status: "pending" },
];

test("accepts a phased list with one active item", () => {
	assert.equal(validateProgress(valid), undefined);
});

test("accepts a fully finished list without an active item", () => {
	assert.equal(
		validateProgress(valid.map((item) => ({ ...item, status: "completed" }))),
		undefined,
	);
});

test("rejects lists that would add overhead to simple work", () => {
	assert.match(validateProgress(valid.slice(0, 2)) ?? "", /at least three/);
});

test("requires exactly one active item while work remains", () => {
	assert.match(
		validateProgress(valid.map((item) => ({ ...item, status: "pending" }))) ?? "",
		/Exactly one/,
	);
	assert.match(
		validateProgress([...valid, { content: "Review", status: "in_progress" }]) ?? "",
		/Exactly one/,
	);
});

test("rejects empty and duplicate item names", () => {
	assert.match(validateProgress([{ ...valid[0], content: " " }, ...valid.slice(1)]) ?? "", /cannot be empty/);
	assert.match(validateProgress([...valid, { content: valid[0].content, status: "pending" }]) ?? "", /Duplicate/);
});

test("clones normalized state and reports completion", () => {
	const cloned = cloneProgress([{ ...valid[0], content: `  ${valid[0].content}  ` }, ...valid.slice(1)]);
	assert.notEqual(cloned, valid);
	assert.equal(cloned[0].content, valid[0].content);
	assert.deepEqual(progressCounts(cloned), { completed: 1, total: 3 });
});
