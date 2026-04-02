export declare function resolveSandboxInputPath(filePath: string, cwd: string): string;
export declare function resolveSandboxPath(params: {
    filePath: string;
    cwd: string;
    root: string;
    allowPaths?: string[];
}): {
    resolved: string;
    relative: string;
    appliedRoot: string;
};
export declare function assertSandboxPath(params: {
    filePath: string;
    cwd: string;
    root: string;
    allowPaths?: string[];
    allowFinalSymlinkForUnlink?: boolean;
    allowFinalHardlinkForUnlink?: boolean;
}): Promise<{
    resolved: string;
    relative: string;
    appliedRoot: string;
}>;
export declare function assertMediaNotDataUrl(media: string): void;
export declare function resolveSandboxedMediaSource(params: {
    media: string;
    sandboxRoot: string;
}): Promise<string>;
