import assert from "node:assert/strict";
import test from "node:test";
import { protectedFragments, validateRewrite } from "./integrity.ts";

test("protectedFragments captures technical values that the editor must preserve", () => {
	const source = [
		"Run `npm test` against /home/user/project and keep 42 results.",
		"See https://example.com/report.",
		"```bash",
		"npm run check",
		"```",
	].join("\n");

	const fragments = protectedFragments(source);
	assert.ok(fragments.includes("`npm test`"));
	assert.ok(fragments.includes("/home/user/project"));
	assert.ok(fragments.includes("42"));
	assert.ok(fragments.includes("https://example.com/report"));
	assert.ok(!fragments.includes("https://example.com/report."));
	assert.ok(fragments.some((value) => value.includes("npm run check")));
});

test("validateRewrite accepts a concise rewrite that preserves protected content", () => {
	const source = "Run `npm test` in /home/user/project. It found 42 passing tests.";
	const rewritten = "In /home/user/project, `npm test` found all 42 tests passing.";
	assert.equal(validateRewrite(source, rewritten), undefined);
});

test("validateRewrite accepts a rewrite that moves a sentence-ending URL", () => {
	const source = "Full details are in the report at https://example.com/report.";
	const rewritten = "Report: https://example.com/report";
	assert.equal(validateRewrite(source, rewritten), undefined);
});

test("validateRewrite rejects dropped protected content", () => {
	const source = "Run `npm test` in /home/user/project. It found 42 passing tests.";
	const rewritten = "The test suite passed.";
	assert.match(validateRewrite(source, rewritten) ?? "", /dropped protected content/);
});

test("validateRewrite rejects an empty editor response", () => {
	assert.equal(validateRewrite("Useful answer", "  "), "Editor returned an empty response");
});
