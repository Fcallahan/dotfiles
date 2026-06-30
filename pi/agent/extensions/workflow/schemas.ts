export const findingReportSchema = {
  type: "object",
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "title", "description", "evidence", "recommendation", "confidence"],
        properties: {
          severity: { enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
          title: { type: "string" },
          description: { type: "string" },
          file_path: { type: "string" },
          line_start: { type: "integer" },
          line_end: { type: "integer" },
          evidence: { type: "string" },
          recommendation: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};

export const implementationPatchReportSchema = {
  type: "object",
  required: ["summary", "files_changed", "patch_ref", "test_commands_run", "test_results", "risks", "manual_steps"],
  properties: {
    summary: { type: "string" },
    files_changed: { type: "array", items: { type: "string" } },
    patch_ref: { type: "string" },
    test_commands_run: { type: "array", items: { type: "string" } },
    test_results: {
      type: "array",
      items: {
        type: "object",
        required: ["command", "status", "output_ref"],
        properties: {
          command: { type: "string" },
          status: { enum: ["passed", "failed", "skipped"] },
          output_ref: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    manual_steps: { type: "array", items: { type: "string" } },
  },
};

export const repoMapSchema = {
  type: "object",
  required: ["summary", "impacted_files", "subsystems", "test_commands", "constraints"],
  properties: {
    summary: { type: "string" },
    impacted_files: { type: "array", items: { type: "string" } },
    subsystems: { type: "array", items: { type: "string" } },
    test_commands: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
  },
};

export const finalReportSchema = {
  type: "object",
  required: ["summary", "final_report"],
  properties: {
    summary: { type: "string" },
    verdict: { type: "string" },
    final_report: { type: "string" },
    residual_risks: { type: "array", items: { type: "string" } },
    artifact_paths: { type: "array", items: { type: "string" } },
  },
};

export function getSchemaByName(name?: string): unknown {
  switch (name) {
    case "finding_report": return findingReportSchema;
    case "implementation_patch_report": return implementationPatchReportSchema;
    case "repo_map": return repoMapSchema;
    case "final_report": return finalReportSchema;
    default: return undefined;
  }
}
