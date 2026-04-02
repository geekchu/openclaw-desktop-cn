import type { ImageSanitizationLimits } from "./image-sanitization.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
export { CLAUDE_PARAM_GROUPS, assertRequiredParams, normalizeToolParams, patchToolSchemaForClaudeCompatibility, wrapToolParamNormalization, } from "./pi-tools.params.js";
type OpenClawReadToolOptions = {
    modelContextWindowTokens?: number;
    imageSanitization?: ImageSanitizationLimits;
};
export declare function wrapToolWorkspaceRootGuard(tool: AnyAgentTool, root: string, allowPaths?: string[], denyPaths?: string[]): AnyAgentTool;
export declare function resolveToolPathAgainstWorkspaceRoot(params: {
    filePath: string;
    root: string;
    containerWorkdir?: string;
}): string;
type MemoryFlushAppendOnlyWriteOptions = {
    root: string;
    relativePath: string;
    containerWorkdir?: string;
    sandbox?: {
        root: string;
        bridge: SandboxFsBridge;
    };
};
export declare function wrapToolMemoryFlushAppendOnlyWrite(tool: AnyAgentTool, options: MemoryFlushAppendOnlyWriteOptions): AnyAgentTool;
export declare function wrapToolWorkspaceRootGuardWithOptions(tool: AnyAgentTool, root: string, options?: {
    containerWorkdir?: string;
}): AnyAgentTool;
/**
 * Wrap the exec tool to enforce directory access restrictions.
 * When workspaceOnly is enabled, this guard:
 * 1. Validates the `workdir` parameter against allowed directories
 * 2. Scans the `command` string for absolute paths and rejects commands
 *    that reference paths outside the workspace or allowed directories
 * 3. Detects relative path traversals (../) that could escape the workspace
 * 4. Blocks shell evasion patterns (command substitution with path references)
 */
export declare function wrapExecToolPathGuard(tool: AnyAgentTool, workspaceRoot: string, allowedDirs?: string[], denyDirs?: string[]): AnyAgentTool;
type SandboxToolParams = {
    root: string;
    bridge: SandboxFsBridge;
    modelContextWindowTokens?: number;
    imageSanitization?: ImageSanitizationLimits;
};
export declare function createSandboxedReadTool(params: SandboxToolParams): AnyAgentTool;
export declare function createSandboxedWriteTool(params: SandboxToolParams): AnyAgentTool;
export declare function createSandboxedEditTool(params: SandboxToolParams): AnyAgentTool;
export declare function createHostWorkspaceWriteTool(root: string, options?: {
    workspaceOnly?: boolean;
}): AnyAgentTool;
export declare function createHostWorkspaceEditTool(root: string, options?: {
    workspaceOnly?: boolean;
}): AnyAgentTool;
export declare function createOpenClawReadTool(base: AnyAgentTool, options?: OpenClawReadToolOptions): AnyAgentTool;
