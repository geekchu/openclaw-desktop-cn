import type { AnyAgentTool } from "./pi-tools.types.js";
export type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
  validator?: (record: Record<string, unknown>) => boolean;
};
export declare const REQUIRED_PARAM_GROUPS: {
  readonly read: readonly [
    {
      readonly keys: readonly ["path", "file_path", "filePath", "file"];
      readonly label: "path";
    },
  ];
  readonly write: readonly [
    {
      readonly keys: readonly ["path", "file_path", "filePath", "file"];
      readonly label: "path";
    },
    {
      readonly keys: readonly ["content"];
      readonly label: "content";
    },
  ];
  readonly edit: readonly [
    {
      readonly keys: readonly ["path", "file_path", "filePath", "file"];
      readonly label: "path";
    },
    {
      readonly keys: readonly ["edits"];
      readonly label: "edits";
      readonly validator: (record: Record<string, unknown>) => boolean;
    },
  ];
};
export declare const CLAUDE_PARAM_GROUPS: typeof REQUIRED_PARAM_GROUPS;
export declare function getToolParamsRecord(params: unknown): Record<string, unknown> | undefined;
export declare function normalizeToolParams(params: unknown): Record<string, unknown> | undefined;
export declare function patchToolSchemaForClaudeCompatibility(tool: AnyAgentTool): AnyAgentTool;
export declare function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void;
export declare function wrapToolParamValidation(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool;
export declare function wrapToolParamNormalization(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool;
