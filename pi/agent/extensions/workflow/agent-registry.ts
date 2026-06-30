import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentDefinition } from "./types.ts";
import { builtinAgents } from "./builtin-agents.ts";
import { parseYaml, stringifyYaml } from "./yaml.ts";
import { ensureDir, getAgentsDir, listFilesRecursive, pathExists } from "./utils.ts";

function splitFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  const normalized = content.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: normalized };
  const rawMeta = normalized.slice(4, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1);
  const parsed = parseYaml(rawMeta);
  return { meta: (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {}, body };
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((part) => part.trim()).filter(Boolean);
  return undefined;
}

function parseAgentFile(filePath: string, source: "user" | "project"): AgentDefinition {
  const content = fs.readFileSync(filePath, "utf8");
  const { meta, body } = splitFrontmatter(content);
  const name = String(meta.name ?? path.basename(filePath, path.extname(filePath)));
  const description = String(meta.description ?? "Workflow agent");
  return {
    name,
    description,
    model: typeof meta.model === "string" ? meta.model : undefined,
    effort: ["low", "medium", "high", "xhigh"].includes(String(meta.effort)) ? meta.effort as AgentDefinition["effort"] : undefined,
    tools: arrayOfStrings(meta.tools),
    disallowed_tools: arrayOfStrings(meta.disallowed_tools),
    max_turns: typeof meta.max_turns === "number" ? meta.max_turns : undefined,
    timeout_seconds: typeof meta.timeout_seconds === "number" ? meta.timeout_seconds : undefined,
    isolation: meta.isolation === "worktree" ? "worktree" : "none",
    permission_mode: typeof meta.permission_mode === "string" ? meta.permission_mode as AgentDefinition["permission_mode"] : undefined,
    output_schema: typeof meta.output_schema === "string" ? meta.output_schema : undefined,
    prompt: body.trim(),
    source,
    filePath,
  };
}

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  static load(cwd: string): AgentRegistry {
    const registry = new AgentRegistry();
    for (const agent of builtinAgents) registry.agents.set(agent.name, { ...agent, source: "builtin" });

    const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
    registry.loadDir(userDir, "user");
    registry.loadDir(getAgentsDir(cwd), "project");
    return registry;
  }

  private loadDir(dir: string, source: "user" | "project"): void {
    for (const file of listFilesRecursive(dir, (f) => f.endsWith(".md"))) {
      try {
        const agent = parseAgentFile(file, source);
        this.agents.set(agent.name, agent);
      } catch (error) {
        // Keep discovery robust; validation will fail if a requested agent is missing.
        console.error(`Failed to parse workflow agent ${file}:`, error);
      }
    }
  }

  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  require(name: string): AgentDefinition {
    const agent = this.get(name);
    if (!agent) {
      const available = Array.from(this.agents.keys()).sort().join(", ");
      throw new Error(`Unknown workflow agent '${name}'. Available: ${available}`);
    }
    return agent;
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function writeDefaultAgentFiles(cwd: string, overwrite = false): string[] {
  const dir = getAgentsDir(cwd);
  ensureDir(dir);
  const written: string[] = [];
  for (const agent of builtinAgents) {
    const file = path.join(dir, `${agent.name}.md`);
    if (!overwrite && pathExists(file)) continue;
    const { prompt, source: _source, filePath: _filePath, ...meta } = agent;
    const content = `---\n${stringifyYaml(meta)}\n---\n\n${prompt.trim()}\n`;
    fs.writeFileSync(file, content, "utf8");
    written.push(file);
  }
  return written;
}
