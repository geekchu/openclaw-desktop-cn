import type { AnyAgentTool } from "./pi-tools.types.js";

export type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
  validator?: (record: Record<string, unknown>) => boolean;
};

const RETRY_GUIDANCE_SUFFIX = " Supply correct parameters before retrying.";
const PATH_PARAM_KEYS = ["path", "file_path", "filePath", "file"] as const;

const CLAUDE_PARAM_ALIASES = [
  { original: "path", alias: "file_path" },
  { original: "path", alias: "filePath" },
  { original: "path", alias: "file" },
  { original: "oldText", alias: "old_string" },
  { original: "oldText", alias: "old_text" },
  { original: "oldText", alias: "oldString" },
  { original: "newText", alias: "new_string" },
  { original: "newText", alias: "new_text" },
  { original: "newText", alias: "newString" },
] as const;

function parameterValidationError(message: string): Error {
  return new Error(`${message}.${RETRY_GUIDANCE_SUFFIX}`);
}

function extractStructuredText(value: unknown, depth = 0): string | undefined {
  if (depth > 6) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  // Top-level arrays are ambiguous multi-block payloads. Keep rejecting those
  // so tools do not silently coerce malformed write/edit requests.
  if (Array.isArray(value)) {
    if (depth === 0) {
      return undefined;
    }
    const parts = value
      .map((entry) => extractStructuredText(entry, depth + 1))
      .filter((entry): entry is string => typeof entry === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return extractStructuredText(record.content, depth + 1);
  }
  if (Array.isArray(record.parts)) {
    return extractStructuredText(record.parts, depth + 1);
  }
  if (typeof record.value === "string" && record.value.length > 0) {
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
    if (type.includes("text") || kind === "text") {
      return record.value;
    }
  }
  return undefined;
}

function normalizeTextLikeParam(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (typeof value === "string") {
    return;
  }
  const extracted = extractStructuredText(value);
  if (typeof extracted === "string") {
    record[key] = extracted;
  }
}

function describeReceivedParamValue(value: unknown, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    if (allowEmpty || value.trim().length > 0) {
      return undefined;
    }
    return "<empty-string>";
  }
  if (Array.isArray(value)) {
    return "<array>";
  }
  return `<${typeof value}>`;
}

function formatReceivedParamHint(
  record: Record<string, unknown>,
  groups: readonly RequiredParamGroup[],
): string {
  const allowEmptyKeys = new Set(
    groups.filter((group) => group.allowEmpty).flatMap((group) => group.keys),
  );
  const received = Object.keys(record).flatMap((key) => {
    const detail = describeReceivedParamValue(record[key], allowEmptyKeys.has(key));
    if (record[key] === undefined || record[key] === null) {
      return [];
    }
    return [detail ? `${key}=${detail}` : key];
  });
  return received.length > 0 ? ` (received: ${received.join(", ")})` : "";
}

type EditReplacement = {
  oldText: string;
  newText: string;
};

function isValidEditReplacement(value: unknown): value is EditReplacement {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.oldText === "string" &&
    record.oldText.trim().length > 0 &&
    typeof record.newText === "string"
  );
}

function hasValidEditReplacements(record: Record<string, unknown>): boolean {
  const edits = record.edits;
  return (
    Array.isArray(edits) &&
    edits.length > 0 &&
    edits.every((entry) => isValidEditReplacement(entry))
  );
}

function addClaudeParamAliasesToSchema(params: {
  properties: Record<string, unknown>;
  required: string[];
}): boolean {
  let changed = false;
  for (const { original, alias } of CLAUDE_PARAM_ALIASES) {
    if (!(original in params.properties)) {
      continue;
    }
    if (!(alias in params.properties)) {
      params.properties[alias] = params.properties[original];
      changed = true;
    }
    const requiredIndex = params.required.indexOf(original);
    if (requiredIndex !== -1) {
      params.required.splice(requiredIndex, 1);
      changed = true;
    }
  }
  return changed;
}

function normalizeClaudeParamAliases(record: Record<string, unknown>) {
  for (const { original, alias } of CLAUDE_PARAM_ALIASES) {
    const aliasValue = record[alias];
    const currentValue = record[original];
    const aliasIsUsable =
      typeof aliasValue === "string" && (original === "newText" || aliasValue.trim().length > 0);
    const shouldUseAlias =
      aliasIsUsable &&
      (!(original in record) ||
        currentValue === undefined ||
        currentValue === null ||
        typeof currentValue !== "string" ||
        currentValue.trim().length === 0);
    if (alias in record && shouldUseAlias) {
      record[original] = aliasValue;
    }
    delete record[alias];
  }
}

function synthesizeEditReplacements(record: Record<string, unknown>) {
  if ("edits" in record) {
    return;
  }
  const oldText = record.oldText;
  const newText = record.newText;
  if (typeof oldText === "string" && oldText.trim().length > 0 && typeof newText === "string") {
    record.edits = [{ oldText, newText }];
  }
}

export const REQUIRED_PARAM_GROUPS = {
  read: [{ keys: PATH_PARAM_KEYS, label: "path" }],
  write: [
    { keys: PATH_PARAM_KEYS, label: "path" },
    { keys: ["content"], label: "content" },
  ],
  edit: [
    { keys: PATH_PARAM_KEYS, label: "path" },
    { keys: ["edits"], label: "edits", validator: hasValidEditReplacements },
  ],
} as const;

export const CLAUDE_PARAM_GROUPS = REQUIRED_PARAM_GROUPS;

export function getToolParamsRecord(params: unknown): Record<string, unknown> | undefined {
  return params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
}

// Normalize Claude-style aliases into the canonical parameter names our tools
// execute with before validation/path checks run.
export function normalizeToolParams(params: unknown): Record<string, unknown> | undefined {
  const record = getToolParamsRecord(params);
  if (!record) {
    return undefined;
  }
  const normalized = { ...record };
  normalizeClaudeParamAliases(normalized);
  normalizeTextLikeParam(normalized, "content");
  normalizeTextLikeParam(normalized, "oldText");
  normalizeTextLikeParam(normalized, "newText");
  synthesizeEditReplacements(normalized);
  return normalized;
}

export function patchToolSchemaForClaudeCompatibility(tool: AnyAgentTool): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as {
          properties?: Record<string, unknown>;
          required?: unknown;
        })
      : undefined;
  if (!schema || !schema.properties || typeof schema.properties !== "object") {
    return tool;
  }

  const properties = { ...schema.properties };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const changed = addClaudeParamAliasesToSchema({ properties, required });
  if (!changed) {
    return tool;
  }

  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties,
      required,
    },
  };
}

export function assertRequiredParams(
  record: Record<string, unknown> | undefined,
  groups: readonly RequiredParamGroup[],
  toolName: string,
): void {
  if (!record || typeof record !== "object") {
    throw parameterValidationError(`Missing parameters for ${toolName}`);
  }

  const missingLabels: string[] = [];
  for (const group of groups) {
    const satisfied =
      group.validator?.(record) ??
      group.keys.some((key) => {
        if (!(key in record)) {
          return false;
        }
        const value = record[key];
        if (typeof value !== "string") {
          return false;
        }
        if (group.allowEmpty) {
          return true;
        }
        return value.trim().length > 0;
      });

    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      missingLabels.push(label);
    }
  }

  if (missingLabels.length > 0) {
    const joined = missingLabels.join(", ");
    const noun = missingLabels.length === 1 ? "parameter" : "parameters";
    const receivedHint = formatReceivedParamHint(record, groups);
    throw parameterValidationError(`Missing required ${noun}: ${joined}${receivedHint}`);
  }
}

export function wrapToolParamValidation(
  tool: AnyAgentTool,
  requiredParamGroups?: readonly RequiredParamGroup[],
): AnyAgentTool {
  const patched = patchToolSchemaForClaudeCompatibility(tool);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object" ? (params as Record<string, unknown>) : undefined);
      if (requiredParamGroups?.length) {
        assertRequiredParams(record, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}

export const wrapToolParamNormalization = wrapToolParamValidation;
