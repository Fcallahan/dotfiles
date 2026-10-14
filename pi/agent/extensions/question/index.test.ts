import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Use Pi's loader: its bundled TUI/TypeBox aliases are not standalone npm packages.
// Global/bundled installs can supply their SDK module URL without installing dependencies here.
const { DefaultResourceLoader, SettingsManager, createEventBus } = await import(
	process.env.PI_SDK_MODULE ?? "@earendil-works/pi-coding-agent"
);
const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

async function setup(custom: () => Promise<unknown>, mode = "tui") {
	const cwd = await mkdtemp(join(tmpdir(), "pi-question-test-"));
	const events: { name: string; data: unknown }[] = [];
	const eventBus = createEventBus();
	eventBus.on("herdr:blocked", (data: unknown) => events.push({ name: "herdr:blocked", data }));
	try {
		const loader = new DefaultResourceLoader({
			cwd, agentDir: cwd, eventBus,
			settingsManager: SettingsManager.inMemory({}),
			additionalExtensionPaths: [extensionPath],
			noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		});
		await loader.reload();
		const loaded = loader.getExtensions();
		assert.deepEqual(loaded.errors, []);
		const tool = loaded.extensions[0].tools.get("question").definition;
		return {
			events,
			ask: (text: string, options = [{ label: "Proceed" }]) => tool.execute(
				"decision-test", { question: text, options }, new AbortController().signal,
				undefined, { mode, ui: { custom } },
			),
		};
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

test("a pending decision reports its first line to Herdr and clears after the answer", async () => {
	let answer!: (value: unknown) => void;
	const probe = await setup(() => new Promise((resolve) => { answer = resolve; }));
	const pending = probe.ask("Approve the release?\n\nCommit details below.");
	assert.deepEqual(probe.events, [{ name: "herdr:blocked", data: { active: true, label: "Approve the release?" } }]);
	answer({ answer: "Proceed", wasCustom: false, index: 1 });
	await pending;
	assert.deepEqual(probe.events[1], { name: "herdr:blocked", data: { active: false } });
	assert.equal(probe.events.length, 2);
});

test("long decision labels are bounded without including the full commit body", async () => {
	const probe = await setup(async () => null);
	await probe.ask("x".repeat(200) + "\nprivate body");
	assert.deepEqual(probe.events[0], { name: "herdr:blocked", data: { active: true, label: "x".repeat(160) } });
});

test("canceling a decision clears its attention state", async () => {
	const probe = await setup(async () => null);
	await probe.ask("Choose an approach");
	assert.deepEqual(probe.events.at(-1), { name: "herdr:blocked", data: { active: false } });
});

test("a failed dialog clears its attention state instead of leaving the session blocked", async () => {
	const probe = await setup(async () => { throw new Error("Dialog closed"); });
	await assert.rejects(probe.ask("Choose an approach"), /Dialog closed/);
	assert.deepEqual(probe.events.at(-1), { name: "herdr:blocked", data: { active: false } });
});

test("headless execution and invalid options do not raise attention", async () => {
	const headless = await setup(async () => { throw new Error("UI must not run"); }, "rpc");
	await headless.ask("Choose an approach");
	assert.deepEqual(headless.events, []);
	const invalid = await setup(async () => { throw new Error("UI must not run"); });
	await invalid.ask("Choose an approach", []);
	assert.deepEqual(invalid.events, []);
});
