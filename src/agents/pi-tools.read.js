import fs from "node:fs/promises";
import path from "node:path";
import { createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import { appendFileWithinRoot, SafeOpenError, openFileWithinRoot, readFileWithinRoot, writeFileWithinRoot, } from "../infra/fs-safe.js";
import { trySafeFileURLToPath } from "../infra/local-file-access.js";
import { detectMime } from "../media/mime.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { toRelativeWorkspacePath } from "./path-policy.js";
import { wrapEditToolWithRecovery } from "./pi-tools.host-edit.js";
import { CLAUDE_PARAM_GROUPS, assertRequiredParams, normalizeToolParams, patchToolSchemaForClaudeCompatibility, wrapToolParamNormalization, } from "./pi-tools.params.js";
import { assertSandboxPath } from "./sandbox-paths.js";
import { sanitizeToolResultImages } from "./tool-images.js";
export { CLAUDE_PARAM_GROUPS, assertRequiredParams, normalizeToolParams, patchToolSchemaForClaudeCompatibility, wrapToolParamNormalization, } from "./pi-tools.params.js";
const DEFAULT_READ_PAGE_MAX_BYTES = 50 * 1024;
const MAX_ADAPTIVE_READ_MAX_BYTES = 512 * 1024;
const ADAPTIVE_READ_CONTEXT_SHARE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ADAPTIVE_READ_PAGES = 8;
const READ_CONTINUATION_NOTICE_RE = /\n\n\[(?:Showing lines [^\]]*?Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\]\s*$/;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function resolveAdaptiveReadMaxBytes(options) {
    const contextWindowTokens = options?.modelContextWindowTokens;
    if (typeof contextWindowTokens !== "number" ||
        !Number.isFinite(contextWindowTokens) ||
        contextWindowTokens <= 0) {
        return DEFAULT_READ_PAGE_MAX_BYTES;
    }
    const fromContext = Math.floor(contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * ADAPTIVE_READ_CONTEXT_SHARE);
    return clamp(fromContext, DEFAULT_READ_PAGE_MAX_BYTES, MAX_ADAPTIVE_READ_MAX_BYTES);
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)}KB`;
    }
    return `${bytes}B`;
}
function getToolResultText(result) {
    const content = Array.isArray(result.content) ? result.content : [];
    const textBlocks = content
        .map((block) => {
        if (block &&
            typeof block === "object" &&
            block.type === "text" &&
            typeof block.text === "string") {
            return block.text;
        }
        return undefined;
    })
        .filter((value) => typeof value === "string");
    if (textBlocks.length === 0) {
        return undefined;
    }
    return textBlocks.join("\n");
}
function withToolResultText(result, text) {
    const content = Array.isArray(result.content) ? result.content : [];
    let replaced = false;
    const nextContent = content.map((block) => {
        if (!replaced &&
            block &&
            typeof block === "object" &&
            block.type === "text") {
            replaced = true;
            return {
                ...block,
                text,
            };
        }
        return block;
    });
    if (replaced) {
        return {
            ...result,
            content: nextContent,
        };
    }
    const textBlock = { type: "text", text };
    return {
        ...result,
        content: [textBlock],
    };
}
function extractReadTruncationDetails(result) {
    const details = result.details;
    if (!details || typeof details !== "object") {
        return null;
    }
    const truncation = details.truncation;
    if (!truncation || typeof truncation !== "object") {
        return null;
    }
    const record = truncation;
    if (record.truncated !== true) {
        return null;
    }
    const outputLinesRaw = record.outputLines;
    const outputLines = typeof outputLinesRaw === "number" && Number.isFinite(outputLinesRaw)
        ? Math.max(0, Math.floor(outputLinesRaw))
        : 0;
    return {
        truncated: true,
        outputLines,
        firstLineExceedsLimit: record.firstLineExceedsLimit === true,
    };
}
function stripReadContinuationNotice(text) {
    return text.replace(READ_CONTINUATION_NOTICE_RE, "");
}
function stripReadTruncationContentDetails(result) {
    const details = result.details;
    if (!details || typeof details !== "object") {
        return result;
    }
    const detailsRecord = details;
    const truncationRaw = detailsRecord.truncation;
    if (!truncationRaw || typeof truncationRaw !== "object") {
        return result;
    }
    const truncation = truncationRaw;
    if (!Object.prototype.hasOwnProperty.call(truncation, "content")) {
        return result;
    }
    const { content: _content, ...restTruncation } = truncation;
    return {
        ...result,
        details: {
            ...detailsRecord,
            truncation: restTruncation,
        },
    };
}
async function executeReadWithAdaptivePaging(params) {
    const userLimit = params.args.limit;
    const hasExplicitLimit = typeof userLimit === "number" && Number.isFinite(userLimit) && userLimit > 0;
    if (hasExplicitLimit) {
        return await params.base.execute(params.toolCallId, params.args, params.signal);
    }
    const offsetRaw = params.args.offset;
    let nextOffset = typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
        ? Math.floor(offsetRaw)
        : 1;
    let firstResult = null;
    let aggregatedText = "";
    let aggregatedBytes = 0;
    let capped = false;
    let continuationOffset;
    for (let page = 0; page < MAX_ADAPTIVE_READ_PAGES; page += 1) {
        const pageArgs = { ...params.args, offset: nextOffset };
        const pageResult = await params.base.execute(params.toolCallId, pageArgs, params.signal);
        firstResult ??= pageResult;
        const rawText = getToolResultText(pageResult);
        if (typeof rawText !== "string") {
            return pageResult;
        }
        const truncation = extractReadTruncationDetails(pageResult);
        const canContinue = Boolean(truncation?.truncated) &&
            !truncation?.firstLineExceedsLimit &&
            (truncation?.outputLines ?? 0) > 0 &&
            page < MAX_ADAPTIVE_READ_PAGES - 1;
        const pageText = canContinue ? stripReadContinuationNotice(rawText) : rawText;
        const delimiter = aggregatedText ? "\n\n" : "";
        const nextBytes = Buffer.byteLength(`${delimiter}${pageText}`, "utf-8");
        if (aggregatedText && aggregatedBytes + nextBytes > params.maxBytes) {
            capped = true;
            continuationOffset = nextOffset;
            break;
        }
        aggregatedText += `${delimiter}${pageText}`;
        aggregatedBytes += nextBytes;
        if (!canContinue || !truncation) {
            return withToolResultText(pageResult, aggregatedText);
        }
        nextOffset += truncation.outputLines;
        continuationOffset = nextOffset;
        if (aggregatedBytes >= params.maxBytes) {
            capped = true;
            break;
        }
    }
    if (!firstResult) {
        return await params.base.execute(params.toolCallId, params.args, params.signal);
    }
    let finalText = aggregatedText;
    if (capped && continuationOffset) {
        finalText += `\n\n[Read output capped at ${formatBytes(params.maxBytes)} for this call. Use offset=${continuationOffset} to continue.]`;
    }
    return withToolResultText(firstResult, finalText);
}
function rewriteReadImageHeader(text, mimeType) {
    // pi-coding-agent uses: "Read image file [image/png]"
    if (text.startsWith("Read image file [") && text.endsWith("]")) {
        return `Read image file [${mimeType}]`;
    }
    return text;
}
async function normalizeReadImageResult(result, filePath) {
    const content = Array.isArray(result.content) ? result.content : [];
    const image = content.find((b) => !!b &&
        typeof b === "object" &&
        b.type === "image" &&
        typeof b.data === "string" &&
        typeof b.mimeType === "string");
    if (!image) {
        return result;
    }
    if (!image.data.trim()) {
        throw new Error(`read: image payload is empty (${filePath})`);
    }
    const sniffed = await sniffMimeFromBase64(image.data);
    if (!sniffed) {
        return result;
    }
    if (!sniffed.startsWith("image/")) {
        throw new Error(`read: file looks like ${sniffed} but was treated as ${image.mimeType} (${filePath})`);
    }
    if (sniffed === image.mimeType) {
        return result;
    }
    const nextContent = content.map((block) => {
        if (block && typeof block === "object" && block.type === "image") {
            const b = block;
            return { ...b, mimeType: sniffed };
        }
        if (block &&
            typeof block === "object" &&
            block.type === "text" &&
            typeof block.text === "string") {
            const b = block;
            return {
                ...b,
                text: rewriteReadImageHeader(b.text, sniffed),
            };
        }
        return block;
    });
    return { ...result, content: nextContent };
}
function assertDirectPathAccess(filePath, cwd, workspaceRoot, allowedDirs, denyDirs) {
    // Windows paths are case-insensitive; normalize for comparison
    const isWin = process.platform === "win32";
    const norm = (p) => (isWin ? p.toLowerCase() : p);
    let finalAbsPath;
    if (path.isAbsolute(filePath)) {
        finalAbsPath = path.normalize(filePath);
    }
    else {
        finalAbsPath = path.resolve(cwd, filePath);
    }
    let realAbsPath = finalAbsPath;
    try {
        const fs = require("node:fs");
        realAbsPath = fs.realpathSync(finalAbsPath);
    }
    catch {
        // ignore
    }
    // Deny list takes precedence — unconditionally block access to protected dirs
    if (denyDirs && denyDirs.length > 0) {
        for (const denied of denyDirs) {
            let realDenied = path.resolve(denied);
            try {
                const fs = require("node:fs");
                realDenied = fs.realpathSync(realDenied);
            }
            catch {
                // ignore
            }
            const rel = path.relative(norm(realDenied), norm(realAbsPath));
            if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
                throw new Error(`Permission denied: '${filePath}' is inside a protected OpenClaw directory and cannot be modified.`);
            }
        }
    }
    const allowedRoots = [path.resolve(workspaceRoot)];
    if (allowedDirs && allowedDirs.length > 0) {
        for (const dir of allowedDirs) {
            allowedRoots.push(path.resolve(dir));
        }
    }
    for (const root of allowedRoots) {
        let realRoot = root;
        try {
            const fs = require("node:fs");
            realRoot = fs.realpathSync(realRoot);
        }
        catch {
            // ignore
        }
        const relative = path.relative(norm(realRoot), norm(realAbsPath));
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
            return;
        }
    }
    throw new Error(`Permission denied: You do not have permission to access '${filePath}'. Path is outside the workspace and not in any manually allowed directories.`);
}
export function wrapToolWorkspaceRootGuard(tool, root, allowPaths, denyPaths) {
    if (allowPaths || denyPaths) {
        // CN desktop: use assertDirectPathAccess for allowPaths/denyPaths support
        return {
            ...tool,
            execute: async (toolCallId, args, signal, onUpdate) => {
                const normalized = normalizeToolParams(args);
                const record = normalized ??
                    (args && typeof args === "object" ? args : undefined);
                // Some tools like `ls` might use `dir` or `path` depending on schema. We check both.
                const targetPath = record?.path ?? record?.dir ?? record?.file_path ?? record?.dir_path;
                if (typeof targetPath === "string" && targetPath.trim()) {
                    assertDirectPathAccess(targetPath, root, root, allowPaths, denyPaths);
                }
                return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
            },
        };
    }
    return wrapToolWorkspaceRootGuardWithOptions(tool, root);
}
function mapContainerPathToWorkspaceRoot(params) {
    const containerWorkdir = params.containerWorkdir?.trim();
    if (!containerWorkdir) {
        return params.filePath;
    }
    const normalizedWorkdir = containerWorkdir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalizedWorkdir.startsWith("/")) {
        return params.filePath;
    }
    if (!normalizedWorkdir) {
        return params.filePath;
    }
    let candidate = params.filePath.startsWith("@") ? params.filePath.slice(1) : params.filePath;
    if (/^file:\/\//i.test(candidate)) {
        const localFilePath = trySafeFileURLToPath(candidate);
        if (!localFilePath) {
            return params.filePath;
        }
        candidate = localFilePath;
    }
    const normalizedCandidate = candidate.replace(/\\/g, "/");
    if (normalizedCandidate === normalizedWorkdir) {
        return path.resolve(params.root);
    }
    const prefix = `${normalizedWorkdir}/`;
    if (!normalizedCandidate.startsWith(prefix)) {
        return candidate;
    }
    const relative = normalizedCandidate.slice(prefix.length);
    if (!relative) {
        return path.resolve(params.root);
    }
    return path.resolve(params.root, ...relative.split("/").filter(Boolean));
}
export function resolveToolPathAgainstWorkspaceRoot(params) {
    const mapped = mapContainerPathToWorkspaceRoot(params);
    const candidate = mapped.startsWith("@") ? mapped.slice(1) : mapped;
    return path.isAbsolute(candidate)
        ? path.resolve(candidate)
        : path.resolve(params.root, candidate || ".");
}
async function readOptionalUtf8File(params) {
    try {
        if (params.sandbox) {
            const stat = await params.sandbox.bridge.stat({
                filePath: params.relativePath,
                cwd: params.sandbox.root,
                signal: params.signal,
            });
            if (!stat) {
                return "";
            }
            const buffer = await params.sandbox.bridge.readFile({
                filePath: params.relativePath,
                cwd: params.sandbox.root,
                signal: params.signal,
            });
            return buffer.toString("utf-8");
        }
        return await fs.readFile(params.absolutePath, "utf-8");
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return "";
        }
        throw error;
    }
}
async function appendMemoryFlushContent(params) {
    if (!params.sandbox) {
        await appendFileWithinRoot({
            rootDir: params.root,
            relativePath: params.relativePath,
            data: params.content,
            mkdir: true,
            prependNewlineIfNeeded: true,
        });
        return;
    }
    const existing = await readOptionalUtf8File({
        absolutePath: params.absolutePath,
        relativePath: params.relativePath,
        sandbox: params.sandbox,
        signal: params.signal,
    });
    const separator = existing.length > 0 && !existing.endsWith("\n") && !params.content.startsWith("\n") ? "\n" : "";
    const next = `${existing}${separator}${params.content}`;
    if (params.sandbox) {
        const parent = path.posix.dirname(params.relativePath);
        if (parent && parent !== ".") {
            await params.sandbox.bridge.mkdirp({
                filePath: parent,
                cwd: params.sandbox.root,
                signal: params.signal,
            });
        }
        await params.sandbox.bridge.writeFile({
            filePath: params.relativePath,
            cwd: params.sandbox.root,
            data: next,
            mkdir: true,
            signal: params.signal,
        });
        return;
    }
    await fs.mkdir(path.dirname(params.absolutePath), { recursive: true });
    await fs.writeFile(params.absolutePath, next, "utf-8");
}
export function wrapToolMemoryFlushAppendOnlyWrite(tool, options) {
    const allowedAbsolutePath = path.resolve(options.root, options.relativePath);
    return {
        ...tool,
        description: `${tool.description} During memory flush, this tool may only append to ${options.relativePath}.`,
        execute: async (toolCallId, args, signal, onUpdate) => {
            const normalized = normalizeToolParams(args);
            const record = normalized ??
                (args && typeof args === "object" ? args : undefined);
            assertRequiredParams(record, CLAUDE_PARAM_GROUPS.write, tool.name);
            const filePath = typeof record?.path === "string" && record.path.trim() ? record.path : undefined;
            const content = typeof record?.content === "string" ? record.content : undefined;
            if (!filePath || content === undefined) {
                return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
            }
            const resolvedPath = resolveToolPathAgainstWorkspaceRoot({
                filePath,
                root: options.root,
                containerWorkdir: options.containerWorkdir,
            });
            if (resolvedPath !== allowedAbsolutePath) {
                throw new Error(`Memory flush writes are restricted to ${options.relativePath}; use that path only.`);
            }
            await appendMemoryFlushContent({
                absolutePath: allowedAbsolutePath,
                root: options.root,
                relativePath: options.relativePath,
                content,
                sandbox: options.sandbox,
                signal,
            });
            return {
                content: [{ type: "text", text: `Appended content to ${options.relativePath}.` }],
                details: {
                    path: options.relativePath,
                    appendOnly: true,
                },
            };
        },
    };
}
export function wrapToolWorkspaceRootGuardWithOptions(tool, root, options) {
    return {
        ...tool,
        execute: async (toolCallId, args, signal, onUpdate) => {
            const normalized = normalizeToolParams(args);
            const record = normalized ??
                (args && typeof args === "object" ? args : undefined);
            const filePath = record?.path;
            if (typeof filePath === "string" && filePath.trim()) {
                const sandboxPath = mapContainerPathToWorkspaceRoot({
                    filePath,
                    root,
                    containerWorkdir: options?.containerWorkdir,
                });
                await assertSandboxPath({ filePath: sandboxPath, cwd: root, root });
            }
            return tool.execute(toolCallId, normalized ?? args, signal, onUpdate);
        },
    };
}
/**
 * Extract absolute file paths from a shell command string.
 * Catches patterns like:
 * - Windows: C:\path, D:\path, "C:\path with spaces"
 * - Unix: /absolute/path, >/path (redirect targets)
 * Does NOT catch relative paths — those are handled separately by extractTraversalPaths.
 */
function extractAbsolutePathsFromCommand(command) {
    const paths = [];
    // Windows absolute paths: drive letter followed by :\ or :/
    // Match both quoted and unquoted paths
    const winPathRegex = /[A-Za-z]:[\\/][^\s;|&><"'`]*|"([A-Za-z]:[\\/][^"]*)"|'([A-Za-z]:[\\/][^']*)'/g;
    let match;
    while ((match = winPathRegex.exec(command)) !== null) {
        const p = match[1] ?? match[2] ?? match[0];
        if (p) {
            paths.push(p);
        }
    }
    // Unix absolute paths: starting with /
    // Also match paths after redirect operators (>, >>, <) without spaces
    const unixPathRegex = /(?:^|\s|[;|&>=<(])(\/{1,2}[^\s;|&><"'`]+)|"(\/[^"]*)"|'(\/[^']*)'/g;
    while ((match = unixPathRegex.exec(command)) !== null) {
        const p = match[1] ?? match[2] ?? match[3];
        if (p) {
            paths.push(p);
        }
    }
    return paths;
}
/**
 * Extract relative paths containing parent traversal (../) from a command string.
 * These could be used to escape the workspace directory.
 */
function extractTraversalPaths(command) {
    const paths = [];
    // Match paths that contain ../ or ..\ (parent directory traversal)
    // Both quoted and unquoted
    const traversalRegex = /(?:^|\s|[;|&>=<(])((?:\.\.[\\/])+[^\s;|&><"'`]*)|"((?:\.\.[\\/])[^"]*)"|'((?:\.\.[\\/])[^']*)'/g;
    let match;
    while ((match = traversalRegex.exec(command)) !== null) {
        const p = match[1] ?? match[2] ?? match[3];
        if (p) {
            paths.push(p);
        }
    }
    return paths;
}
/**
 * Detect shell evasion patterns that could dynamically construct paths
 * to bypass static path analysis.
 * Returns an error message if a dangerous pattern is detected, null otherwise.
 */
function detectShellEvasion(command) {
    // Command substitution: $(...) or backticks `...`
    // These can dynamically construct paths that bypass static analysis.
    // Only flag when the substitution contains BOTH a file-operation command AND an absolute path.
    const cmdSubRegex = /\$\(([^)]+)\)|`([^`]+)`/g;
    const fileOpRegex = /\b(cat|ls|rm|cp|mv|chmod|chown|mkdir|touch|find|grep|sed|awk|head|tail|readlink|realpath|dirname|basename)\b/;
    let match;
    while ((match = cmdSubRegex.exec(command)) !== null) {
        const inner = match[1] ?? match[2] ?? "";
        // Skip safe command substitutions that don't involve file operations
        // e.g. $(date), $(whoami), $(uname -r), $(git rev-parse HEAD)
        if (!fileOpRegex.test(inner)) {
            continue;
        }
        // Contains a file-op command — check if it also references absolute paths
        if (/\/[^\s)]+/.test(inner) || /[A-Za-z]:[\\/]/.test(inner)) {
            return `Command substitution \`${match[0]}\` may be used to bypass path restrictions. Use explicit paths instead.`;
        }
    }
    return null;
}
/**
 * Wrap the exec tool to enforce directory access restrictions.
 * When workspaceOnly is enabled, this guard:
 * 1. Validates the `workdir` parameter against allowed directories
 * 2. Scans the `command` string for absolute paths and rejects commands
 *    that reference paths outside the workspace or allowed directories
 * 3. Detects relative path traversals (../) that could escape the workspace
 * 4. Blocks shell evasion patterns (command substitution with path references)
 */
export function wrapExecToolPathGuard(tool, workspaceRoot, allowedDirs, denyDirs) {
    return {
        ...tool,
        execute: async (toolCallId, args, signal, onUpdate) => {
            const params = args;
            // 1. Check workdir parameter
            const workdir = params?.workdir;
            if (typeof workdir === "string" && workdir.trim()) {
                assertDirectPathAccess(workdir, workspaceRoot, workspaceRoot, allowedDirs, denyDirs);
            }
            const command = params?.command;
            if (typeof command === "string" && command.trim()) {
                // 2. Scan command string for absolute paths
                const absolutePaths = extractAbsolutePathsFromCommand(command);
                for (const absPath of absolutePaths) {
                    try {
                        assertDirectPathAccess(absPath, workspaceRoot, workspaceRoot, allowedDirs, denyDirs);
                    }
                    catch {
                        throw new Error(`Permission denied: The command references path '${absPath}' which is outside the workspace and allowed directories. ` +
                            `Allowed roots: workspace(${workspaceRoot})${allowedDirs?.length ? `, additional: ${allowedDirs.join(", ")}` : ""}. ` +
                            `Use relative paths or ask the user to add the target directory to the allowed list in Settings.`);
                    }
                }
                // 3. Check relative path traversals (../) that could escape workspace
                const effectiveCwd = typeof workdir === "string" && workdir.trim() ? workdir : workspaceRoot;
                const traversalPaths = extractTraversalPaths(command);
                for (const relPath of traversalPaths) {
                    try {
                        assertDirectPathAccess(relPath, effectiveCwd, workspaceRoot, allowedDirs, denyDirs);
                    }
                    catch {
                        throw new Error(`Permission denied: The command uses parent traversal '${relPath}' which resolves to a path outside the workspace. ` +
                            `Use absolute paths within the workspace or ask the user to add the target directory to the allowed list in Settings.`);
                    }
                }
                // 4. Block shell evasion patterns
                const evasion = detectShellEvasion(command);
                if (evasion) {
                    throw new Error(`Security warning: ${evasion}`);
                }
            }
            return tool.execute(toolCallId, args, signal, onUpdate);
        },
    };
}
export function createSandboxedReadTool(params) {
    const base = createReadTool(params.root, {
        operations: createSandboxReadOperations(params),
    });
    return createOpenClawReadTool(base, {
        modelContextWindowTokens: params.modelContextWindowTokens,
        imageSanitization: params.imageSanitization,
    });
}
export function createSandboxedWriteTool(params) {
    const base = createWriteTool(params.root, {
        operations: createSandboxWriteOperations(params),
    });
    return wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write);
}
export function createSandboxedEditTool(params) {
    const base = createEditTool(params.root, {
        operations: createSandboxEditOperations(params),
    });
    const withRecovery = wrapEditToolWithRecovery(base, {
        root: params.root,
        readFile: async (absolutePath) => (await params.bridge.readFile({ filePath: absolutePath, cwd: params.root })).toString("utf8"),
    });
    return wrapToolParamNormalization(withRecovery, CLAUDE_PARAM_GROUPS.edit);
}
export function createHostWorkspaceWriteTool(root, options) {
    const base = createWriteTool(root, {
        operations: createHostWriteOperations(root, options),
    });
    return wrapToolParamNormalization(base, CLAUDE_PARAM_GROUPS.write);
}
export function createHostWorkspaceEditTool(root, options) {
    const base = createEditTool(root, {
        operations: createHostEditOperations(root, options),
    });
    const withRecovery = wrapEditToolWithRecovery(base, {
        root,
        readFile: (absolutePath) => fs.readFile(absolutePath, "utf-8"),
    });
    return wrapToolParamNormalization(withRecovery, CLAUDE_PARAM_GROUPS.edit);
}
export function createOpenClawReadTool(base, options) {
    const patched = patchToolSchemaForClaudeCompatibility(base);
    return {
        ...patched,
        execute: async (toolCallId, params, signal) => {
            const normalized = normalizeToolParams(params);
            const record = normalized ??
                (params && typeof params === "object" ? params : undefined);
            assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);
            const result = await executeReadWithAdaptivePaging({
                base,
                toolCallId,
                args: (normalized ?? params ?? {}),
                signal,
                maxBytes: resolveAdaptiveReadMaxBytes(options),
            });
            const filePath = typeof record?.path === "string" ? String(record.path) : "<unknown>";
            const strippedDetailsResult = stripReadTruncationContentDetails(result);
            const normalizedResult = await normalizeReadImageResult(strippedDetailsResult, filePath);
            return sanitizeToolResultImages(normalizedResult, `read:${filePath}`, options?.imageSanitization);
        },
    };
}
function createSandboxReadOperations(params) {
    return {
        readFile: (absolutePath) => params.bridge.readFile({ filePath: absolutePath, cwd: params.root }),
        access: async (absolutePath) => {
            const stat = await params.bridge.stat({ filePath: absolutePath, cwd: params.root });
            if (!stat) {
                throw createFsAccessError("ENOENT", absolutePath);
            }
        },
        detectImageMimeType: async (absolutePath) => {
            const buffer = await params.bridge.readFile({ filePath: absolutePath, cwd: params.root });
            const mime = await detectMime({ buffer, filePath: absolutePath });
            return mime && mime.startsWith("image/") ? mime : undefined;
        },
    };
}
function createSandboxWriteOperations(params) {
    return {
        mkdir: async (dir) => {
            await params.bridge.mkdirp({ filePath: dir, cwd: params.root });
        },
        writeFile: async (absolutePath, content) => {
            await params.bridge.writeFile({ filePath: absolutePath, cwd: params.root, data: content });
        },
    };
}
function createSandboxEditOperations(params) {
    return {
        readFile: (absolutePath) => params.bridge.readFile({ filePath: absolutePath, cwd: params.root }),
        writeFile: (absolutePath, content) => params.bridge.writeFile({ filePath: absolutePath, cwd: params.root, data: content }),
        access: async (absolutePath) => {
            const stat = await params.bridge.stat({ filePath: absolutePath, cwd: params.root });
            if (!stat) {
                throw createFsAccessError("ENOENT", absolutePath);
            }
        },
    };
}
async function writeHostFile(absolutePath, content) {
    const resolved = path.resolve(absolutePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
}
function createHostWriteOperations(root, options) {
    const workspaceOnly = options?.workspaceOnly ?? false;
    if (!workspaceOnly) {
        // When workspaceOnly is false, allow writes anywhere on the host
        return {
            mkdir: async (dir) => {
                const resolved = path.resolve(dir);
                await fs.mkdir(resolved, { recursive: true });
            },
            writeFile: writeHostFile,
        };
    }
    // When workspaceOnly is true, enforce workspace boundary
    return {
        mkdir: async (dir) => {
            const relative = toRelativeWorkspacePath(root, dir, { allowRoot: true });
            const resolved = relative ? path.resolve(root, relative) : path.resolve(root);
            await assertSandboxPath({ filePath: resolved, cwd: root, root });
            await fs.mkdir(resolved, { recursive: true });
        },
        writeFile: async (absolutePath, content) => {
            const relative = toRelativeWorkspacePath(root, absolutePath);
            await writeFileWithinRoot({
                rootDir: root,
                relativePath: relative,
                data: content,
                mkdir: true,
            });
        },
    };
}
function createHostEditOperations(root, options) {
    const workspaceOnly = options?.workspaceOnly ?? false;
    if (!workspaceOnly) {
        // When workspaceOnly is false, allow edits anywhere on the host
        return {
            readFile: async (absolutePath) => {
                const resolved = path.resolve(absolutePath);
                return await fs.readFile(resolved);
            },
            writeFile: writeHostFile,
            access: async (absolutePath) => {
                const resolved = path.resolve(absolutePath);
                await fs.access(resolved);
            },
        };
    }
    // When workspaceOnly is true, enforce workspace boundary
    return {
        readFile: async (absolutePath) => {
            const relative = toRelativeWorkspacePath(root, absolutePath);
            const safeRead = await readFileWithinRoot({
                rootDir: root,
                relativePath: relative,
            });
            return safeRead.buffer;
        },
        writeFile: async (absolutePath, content) => {
            const relative = toRelativeWorkspacePath(root, absolutePath);
            await writeFileWithinRoot({
                rootDir: root,
                relativePath: relative,
                data: content,
                mkdir: true,
            });
        },
        access: async (absolutePath) => {
            let relative;
            try {
                relative = toRelativeWorkspacePath(root, absolutePath);
            }
            catch {
                // Path escapes workspace root.  Don't throw here – the upstream
                // library replaces any `access` error with a misleading "File not
                // found" message.  By returning silently the subsequent `readFile`
                // call will throw the same "Path escapes workspace root" error
                // through a code-path that propagates the original message.
                return;
            }
            try {
                const opened = await openFileWithinRoot({
                    rootDir: root,
                    relativePath: relative,
                });
                await opened.handle.close().catch(() => { });
            }
            catch (error) {
                if (error instanceof SafeOpenError && error.code === "not-found") {
                    throw createFsAccessError("ENOENT", absolutePath);
                }
                if (error instanceof SafeOpenError && error.code === "outside-workspace") {
                    // Don't throw here – see the comment above about the upstream
                    // library swallowing access errors as "File not found".
                    return;
                }
                throw error;
            }
        },
    };
}
function createFsAccessError(code, filePath) {
    const error = new Error(`Sandbox FS error (${code}): ${filePath}`);
    error.code = code;
    return error;
}
