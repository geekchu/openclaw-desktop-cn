import type { EnvSanitizationOptions } from "./sanitize-env-vars.js";
type ExecDockerRawOptions = {
    allowFailure?: boolean;
    input?: Buffer | string;
    signal?: AbortSignal;
};
export type ExecDockerRawResult = {
    stdout: Buffer;
    stderr: Buffer;
    code: number;
};
type DockerSpawnRuntime = {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    execPath: string;
};
export declare function resolveDockerSpawnInvocation(args: string[], runtime?: DockerSpawnRuntime): {
    command: string;
    args: string[];
    shell?: boolean;
    windowsHide?: boolean;
};
export declare function execDockerRaw(args: string[], opts?: ExecDockerRawOptions): Promise<ExecDockerRawResult>;
import type { SandboxConfig, SandboxDockerConfig } from "./types.js";
/** Sentinel string embedded in errors so the UI can detect Docker-not-installed. */
export declare const DOCKER_NOT_INSTALLED_MARKER = "[DOCKER_NOT_INSTALLED]";
/** Sentinel string embedded in errors so the UI can detect Docker-not-running. */
export declare const DOCKER_NOT_RUNNING_MARKER = "[DOCKER_NOT_RUNNING]";
export declare function execDocker(args: string[], opts?: {
    allowFailure?: boolean;
}): Promise<{
    stdout: string;
    stderr: string;
    code: number;
}>;
export declare function readDockerContainerLabel(containerName: string, label: string): Promise<string | null>;
export declare function readDockerContainerEnvVar(containerName: string, envVar: string): Promise<string | null>;
export declare function readDockerPort(containerName: string, port: number): Promise<number | null>;
export declare function ensureDockerImage(image: string): Promise<void>;
export declare function dockerContainerState(name: string): Promise<{
    exists: boolean;
    running: boolean;
}>;
export declare function buildSandboxCreateArgs(params: {
    name: string;
    cfg: SandboxDockerConfig;
    scopeKey: string;
    createdAtMs?: number;
    labels?: Record<string, string>;
    configHash?: string;
    includeBinds?: boolean;
    bindSourceRoots?: string[];
    allowSourcesOutsideAllowedRoots?: boolean;
    allowReservedContainerTargets?: boolean;
    allowContainerNamespaceJoin?: boolean;
    envSanitizationOptions?: EnvSanitizationOptions;
}): string[];
export declare function ensureSandboxContainer(params: {
    sessionKey: string;
    workspaceDir: string;
    agentWorkspaceDir: string;
    cfg: SandboxConfig;
}): Promise<string>;
export {};
