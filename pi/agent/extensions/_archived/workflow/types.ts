export type Effort = "low" | "medium" | "high" | "xhigh";
export type Isolation = "none" | "worktree";
export type PhaseStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped" | "pending_approval";
export type RunStatusValue = "created" | "running" | "completed" | "failed" | "cancelled" | "pending_approval";

export interface Workflow {
  version: number;
  name: string;
  description?: string;
  input?: Record<string, unknown>;
  runtime: RuntimeConfig;
  context?: ContextConfig;
  phases: Phase[];
  gates?: Gate[];
  output?: OutputConfig;
}

export interface RuntimeConfig {
  max_parallel_agents: number;
  max_total_agents: number;
  max_runtime_minutes: number;
  default_model: string;
  default_effort?: Effort;
  fail_fast?: boolean;
}

export interface ContextConfig {
  store?: "sqlite";
  artifact_dir?: string;
  compression?: {
    enabled?: boolean;
    max_agent_result_tokens?: number;
  };
}

export type Phase = AgentPhase | ParallelPhase | GatePhase;

export interface BasePhase {
  id: string;
  depends_on?: string[];
  input?: Record<string, unknown>;
  output?: string;
}

export interface AgentPhase extends BasePhase {
  type: "agent";
  agent: string;
  prompt?: string;
  isolation?: Isolation;
}

export interface ParallelPhase extends BasePhase {
  type: "parallel";
  agents: string[];
  prompt?: string;
  isolation?: Isolation;
}

export interface GatePhase extends BasePhase {
  type: "gate";
  gate: "user_approval" | "test" | "schema_validation";
  prompt?: string;
  command?: string;
}

export interface Gate {
  id?: string;
  name?: string;
  when?: string;
  action?: string;
  command?: string;
  required_before?: string[];
  applies_to?: string[];
  rule?: string;
}

export interface OutputConfig {
  format?: "markdown" | "json";
  file?: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  effort?: Effort;
  tools?: string[];
  disallowed_tools?: string[];
  max_turns?: number;
  timeout_seconds?: number;
  isolation?: Isolation;
  permission_mode?: "readonly" | "plan_before_write" | "isolated_auto" | "trusted_auto";
  output_schema?: string;
  prompt: string;
  source?: "builtin" | "user" | "project";
  filePath?: string;
}

export interface AgentResult {
  status: "completed" | "failed" | "cancelled" | "timeout";
  summary: string;
  output_json?: unknown;
  raw_output?: string;
  transcript_ref: string;
  artifacts: string[];
  token_usage?: {
    input: number;
    output: number;
  };
  cost_estimate_cents?: number;
  error?: string;
}

export interface WorkflowRunStatus {
  id: string;
  name: string;
  task: string;
  cwd: string;
  run_dir: string;
  workflow_file: string;
  status: RunStatusValue;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  max_parallel_agents: number;
  max_total_agents: number;
  agent_count: number;
  mutation_approved?: boolean;
  stopped?: boolean;
  error?: string;
  phases: Record<string, PhaseRuntimeStatus>;
  tasks: Record<string, AgentTaskRuntimeStatus>;
  outputs: Record<string, unknown>;
  artifacts: Record<string, string>;
}

export interface PhaseRuntimeStatus {
  id: string;
  type: string;
  status: PhaseStatus;
  depends_on: string[];
  started_at?: string;
  completed_at?: string;
  output_ref?: string;
  error?: string;
  task_ids: string[];
}

export interface AgentTaskRuntimeStatus {
  id: string;
  phase_id: string;
  agent_name: string;
  status: PhaseStatus;
  prompt_ref: string;
  result_ref?: string;
  transcript_ref?: string;
  worktree_path?: string;
  started_at?: string;
  completed_at?: string;
  tokens_input?: number;
  tokens_output?: number;
  cost_estimate_cents?: number;
  error?: string;
}

export interface WorkflowEvent {
  ts: string;
  type: string;
  run_id: string;
  [key: string]: unknown;
}

export interface ExecuteAgentOptions {
  runId: string;
  taskId: string;
  phaseId: string;
  userTask: string;
  agent: AgentDefinition;
  workflow: Workflow;
  phasePrompt?: string;
  phaseInput?: unknown;
  cwd: string;
  runDir: string;
  contextRefs: string[];
  isolation: Isolation;
  signal?: AbortSignal;
}
