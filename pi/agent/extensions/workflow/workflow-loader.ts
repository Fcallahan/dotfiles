import * as fs from "node:fs";
import * as path from "node:path";
import type { Workflow, Phase } from "./types.ts";
import { parseYaml, stringifyYaml } from "./yaml.ts";
import { getTemplate } from "./templates.ts";
import { ensureDir, getWorkflowsDir, pathExists, resolvePath } from "./utils.ts";

export function parseWorkflowText(text: string, filePath = "workflow"): Workflow {
  const raw = filePath.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  return validateWorkflow(raw, filePath);
}

export function loadWorkflow(cwd: string, specOrName: string, task?: string): { workflow: Workflow; filePath: string } {
  const template = getTemplate(specOrName, task ?? specOrName);
  if (template) return { workflow: template, filePath: `<template:${specOrName}>` };

  const candidates = [
    resolvePath(cwd, specOrName),
    path.join(getWorkflowsDir(cwd), specOrName),
    path.join(getWorkflowsDir(cwd), `${specOrName}.yaml`),
    path.join(getWorkflowsDir(cwd), `${specOrName}.yml`),
    path.join(getWorkflowsDir(cwd), `${specOrName}.json`),
  ];
  const filePath = candidates.find(pathExists);
  if (!filePath) throw new Error(`Workflow not found: ${specOrName}`);
  const workflow = parseWorkflowText(fs.readFileSync(filePath, "utf8"), filePath);
  if (task) workflow.input = { ...(workflow.input ?? {}), task };
  return { workflow, filePath };
}

export function validateWorkflow(raw: unknown, filePath = "workflow"): Workflow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${filePath}: workflow must be an object`);
  const workflow = raw as Workflow;
  if (workflow.version !== 1) throw new Error(`${filePath}: version must be 1`);
  if (!workflow.name || typeof workflow.name !== "string") throw new Error(`${filePath}: name is required`);
  if (!workflow.runtime || typeof workflow.runtime !== "object") throw new Error(`${filePath}: runtime is required`);
  if (!Array.isArray(workflow.phases) || workflow.phases.length === 0) throw new Error(`${filePath}: phases must be a non-empty array`);

  const runtime = workflow.runtime;
  runtime.max_parallel_agents = positiveInt(runtime.max_parallel_agents, 4, `${filePath}: runtime.max_parallel_agents`);
  runtime.max_total_agents = positiveInt(runtime.max_total_agents, 16, `${filePath}: runtime.max_total_agents`);
  runtime.max_runtime_minutes = positiveInt(runtime.max_runtime_minutes, 45, `${filePath}: runtime.max_runtime_minutes`);
  runtime.default_model = typeof runtime.default_model === "string" && runtime.default_model ? runtime.default_model : "default";

  const ids = new Set<string>();
  for (const phase of workflow.phases) {
    validatePhase(phase, filePath);
    if (ids.has(phase.id)) throw new Error(`${filePath}: duplicate phase id '${phase.id}'`);
    ids.add(phase.id);
  }
  for (const phase of workflow.phases) {
    for (const dep of phase.depends_on ?? []) {
      if (!ids.has(dep)) throw new Error(`${filePath}: phase '${phase.id}' depends on unknown phase '${dep}'`);
      if (dep === phase.id) throw new Error(`${filePath}: phase '${phase.id}' cannot depend on itself`);
    }
  }
  return workflow;
}

function validatePhase(phase: Phase, filePath: string): void {
  if (!phase || typeof phase !== "object") throw new Error(`${filePath}: invalid phase`);
  if (!phase.id || typeof phase.id !== "string") throw new Error(`${filePath}: phase id is required`);
  if (!Array.isArray(phase.depends_on) && phase.depends_on !== undefined) throw new Error(`${filePath}: phase '${phase.id}' depends_on must be an array`);
  switch (phase.type) {
    case "agent":
      if (!phase.agent || typeof phase.agent !== "string") throw new Error(`${filePath}: agent phase '${phase.id}' requires agent`);
      break;
    case "parallel":
      if (!Array.isArray(phase.agents) || phase.agents.length === 0) throw new Error(`${filePath}: parallel phase '${phase.id}' requires agents`);
      break;
    case "gate":
      if (!phase.gate || typeof phase.gate !== "string") throw new Error(`${filePath}: gate phase '${phase.id}' requires gate`);
      break;
    default:
      throw new Error(`${filePath}: phase '${(phase as { id?: string }).id ?? "?"}' has invalid type '${(phase as { type?: string }).type}'`);
  }
}

function positiveInt(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
  return Math.floor(value);
}

export function writeWorkflowFile(cwd: string, name: string, workflow: Workflow, overwrite = false): string {
  const dir = getWorkflowsDir(cwd);
  ensureDir(dir);
  const file = path.join(dir, `${name}.yaml`);
  if (!overwrite && pathExists(file)) throw new Error(`Workflow already exists: ${file}`);
  fs.writeFileSync(file, `${stringifyYaml(workflow)}\n`, "utf8");
  return file;
}
