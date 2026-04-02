import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import * as tar from "tar";
import { resolveArchiveOutputPath, stripArchivePath, validateArchiveEntryPath, } from "./archive-path.js";
import { createArchiveSymlinkTraversalError, mergeExtractedTreeIntoDestination, prepareArchiveDestinationDir, prepareArchiveOutputPath, withStagedArchiveDestination, } from "./archive-staging.js";
import { sameFileIdentity } from "./file-identity.js";
import { openFileWithinRoot, openWritableFileWithinRoot, SafeOpenError } from "./fs-safe.js";
import { isNotFoundPathError } from "./path-guards.js";
export { ArchiveSecurityError } from "./archive-staging.js";
export { mergeExtractedTreeIntoDestination, prepareArchiveDestinationDir, prepareArchiveOutputPath, withStagedArchiveDestination, } from "./archive-staging.js";
/** @internal */
export const DEFAULT_MAX_ARCHIVE_BYTES_ZIP = 256 * 1024 * 1024;
/** @internal */
export const DEFAULT_MAX_ENTRIES = 50_000;
/** @internal */
export const DEFAULT_MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
/** @internal */
export const DEFAULT_MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const ERROR_ARCHIVE_SIZE_EXCEEDS_LIMIT = "archive size exceeds limit";
const ERROR_ARCHIVE_ENTRY_COUNT_EXCEEDS_LIMIT = "archive entry count exceeds limit";
const ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT = "archive entry extracted size exceeds limit";
const ERROR_ARCHIVE_EXTRACTED_SIZE_EXCEEDS_LIMIT = "archive extracted size exceeds limit";
const SUPPORTS_NOFOLLOW = process.platform !== "win32" && "O_NOFOLLOW" in fsConstants;
const OPEN_WRITE_CREATE_FLAGS = fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    (SUPPORTS_NOFOLLOW ? fsConstants.O_NOFOLLOW : 0);
const TAR_SUFFIXES = [".tgz", ".tar.gz", ".tar"];
export function resolveArchiveKind(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".zip")) {
        return "zip";
    }
    if (TAR_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
        return "tar";
    }
    return null;
}
async function hasPackedRootMarker(extractDir, rootMarkers) {
    for (const marker of rootMarkers) {
        const trimmed = marker.trim();
        if (!trimmed) {
            continue;
        }
        try {
            await fs.stat(path.join(extractDir, trimmed));
            return true;
        }
        catch {
            // ignore
        }
    }
    return false;
}
export async function resolvePackedRootDir(extractDir, options) {
    const direct = path.join(extractDir, "package");
    try {
        const stat = await fs.stat(direct);
        if (stat.isDirectory()) {
            return direct;
        }
    }
    catch {
        // ignore
    }
    if ((options?.rootMarkers?.length ?? 0) > 0) {
        const hasMarker = await hasPackedRootMarker(extractDir, options?.rootMarkers ?? []);
        if (hasMarker) {
            return extractDir;
        }
    }
    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    if (dirs.length !== 1) {
        throw new Error(`unexpected archive layout (dirs: ${dirs.join(", ")})`);
    }
    const onlyDir = dirs[0];
    if (!onlyDir) {
        throw new Error("unexpected archive layout (no package dir found)");
    }
    return path.join(extractDir, onlyDir);
}
export async function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}
function clampLimit(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    const v = Math.floor(value);
    return v > 0 ? v : undefined;
}
function resolveExtractLimits(limits) {
    // Defaults: defensive, but should not break normal installs.
    return {
        maxArchiveBytes: clampLimit(limits?.maxArchiveBytes) ?? DEFAULT_MAX_ARCHIVE_BYTES_ZIP,
        maxEntries: clampLimit(limits?.maxEntries) ?? DEFAULT_MAX_ENTRIES,
        maxExtractedBytes: clampLimit(limits?.maxExtractedBytes) ?? DEFAULT_MAX_EXTRACTED_BYTES,
        maxEntryBytes: clampLimit(limits?.maxEntryBytes) ?? DEFAULT_MAX_ENTRY_BYTES,
    };
}
function assertArchiveEntryCountWithinLimit(entryCount, limits) {
    if (entryCount > limits.maxEntries) {
        throw new Error(ERROR_ARCHIVE_ENTRY_COUNT_EXCEEDS_LIMIT);
    }
}
function createByteBudgetTracker(limits) {
    let entryBytes = 0;
    let extractedBytes = 0;
    const addBytes = (bytes) => {
        const b = Math.max(0, Math.floor(bytes));
        if (b === 0) {
            return;
        }
        entryBytes += b;
        if (entryBytes > limits.maxEntryBytes) {
            throw new Error(ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT);
        }
        extractedBytes += b;
        if (extractedBytes > limits.maxExtractedBytes) {
            throw new Error(ERROR_ARCHIVE_EXTRACTED_SIZE_EXCEEDS_LIMIT);
        }
    };
    return {
        startEntry() {
            entryBytes = 0;
        },
        addBytes,
        addEntrySize(size) {
            const s = Math.max(0, Math.floor(size));
            if (s > limits.maxEntryBytes) {
                throw new Error(ERROR_ARCHIVE_ENTRY_EXTRACTED_SIZE_EXCEEDS_LIMIT);
            }
            // Note: tar budgets are based on the header-declared size.
            addBytes(s);
        },
    };
}
function createExtractBudgetTransform(params) {
    return new Transform({
        transform(chunk, _encoding, callback) {
            try {
                const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
                params.onChunkBytes(buf.byteLength);
                callback(null, buf);
            }
            catch (err) {
                callback(err instanceof Error ? err : new Error(String(err)));
            }
        },
    });
}
function symlinkTraversalError(originalPath) {
    return createArchiveSymlinkTraversalError(originalPath);
}
async function openZipOutputFile(params) {
    try {
        return await openWritableFileWithinRoot({
            rootDir: params.destinationRealDir,
            relativePath: params.relPath,
            mkdir: false,
            mode: 0o666,
        });
    }
    catch (err) {
        if (err instanceof SafeOpenError &&
            (err.code === "invalid-path" ||
                err.code === "outside-workspace" ||
                err.code === "path-mismatch")) {
            throw symlinkTraversalError(params.originalPath);
        }
        throw err;
    }
}
async function cleanupPartialRegularFile(filePath) {
    let stat;
    try {
        stat = await fs.lstat(filePath);
    }
    catch (err) {
        if (isNotFoundPathError(err)) {
            return;
        }
        throw err;
    }
    if (stat.isFile()) {
        await fs.unlink(filePath).catch(() => undefined);
    }
}
function buildArchiveAtomicTempPath(targetPath) {
    return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
}
async function verifyZipWriteResult(params) {
    const opened = await openFileWithinRoot({
        rootDir: params.destinationRealDir,
        relativePath: params.relPath,
        rejectHardlinks: true,
    });
    try {
        if (!sameFileIdentity(opened.stat, params.expectedStat)) {
            throw new SafeOpenError("path-mismatch", "path changed during zip extract");
        }
        return opened.realPath;
    }
    finally {
        await opened.handle.close().catch(() => undefined);
    }
}
async function readZipEntryStream(entry) {
    if (typeof entry.nodeStream === "function") {
        return entry.nodeStream();
    }
    // Old JSZip: fall back to buffering, but still extract via a stream.
    const buf = await entry.async("nodebuffer");
    return Readable.from(buf);
}
function resolveZipOutputPath(params) {
    validateArchiveEntryPath(params.entryPath);
    const relPath = stripArchivePath(params.entryPath, params.strip);
    if (!relPath) {
        return null;
    }
    validateArchiveEntryPath(relPath);
    return {
        relPath,
        outPath: resolveArchiveOutputPath({
            rootDir: params.destinationDir,
            relPath,
            originalPath: params.entryPath,
        }),
    };
}
async function prepareZipOutputPath(params) {
    await prepareArchiveOutputPath(params);
}
async function writeZipFileEntry(params) {
    const opened = await openZipOutputFile({
        relPath: params.relPath,
        originalPath: params.entry.name,
        destinationRealDir: params.destinationRealDir,
    });
    params.budget.startEntry();
    const readable = await readZipEntryStream(params.entry);
    const destinationPath = opened.openedRealPath;
    const targetMode = opened.openedStat.mode & 0o777;
    await opened.handle.close().catch(() => undefined);
    let tempHandle = null;
    let tempPath = null;
    let tempStat = null;
    let handleClosedByStream = false;
    try {
        tempPath = buildArchiveAtomicTempPath(destinationPath);
        tempHandle = await fs.open(tempPath, OPEN_WRITE_CREATE_FLAGS, targetMode || 0o666);
        const writable = tempHandle.createWriteStream();
        writable.once("close", () => {
            handleClosedByStream = true;
        });
        await pipeline(readable, createExtractBudgetTransform({ onChunkBytes: params.budget.addBytes }), writable);
        tempStat = await fs.stat(tempPath);
        if (!tempStat) {
            throw new Error("zip temp write did not produce file metadata");
        }
        if (!handleClosedByStream) {
            await tempHandle.close().catch(() => undefined);
            handleClosedByStream = true;
        }
        tempHandle = null;
        await fs.rename(tempPath, destinationPath);
        tempPath = null;
        const verifiedPath = await verifyZipWriteResult({
            destinationRealDir: params.destinationRealDir,
            relPath: params.relPath,
            expectedStat: tempStat,
        });
        // Best-effort permission restore for zip entries created on unix.
        if (typeof params.entry.unixPermissions === "number") {
            const mode = params.entry.unixPermissions & 0o777;
            if (mode !== 0) {
                await fs.chmod(verifiedPath, mode).catch(() => undefined);
            }
        }
    }
    catch (err) {
        if (tempPath) {
            await fs.rm(tempPath, { force: true }).catch(() => undefined);
        }
        else {
            await cleanupPartialRegularFile(destinationPath).catch(() => undefined);
        }
        if (err instanceof SafeOpenError) {
            throw symlinkTraversalError(params.entry.name);
        }
        throw err;
    }
    finally {
        if (tempHandle && !handleClosedByStream) {
            await tempHandle.close().catch(() => undefined);
        }
    }
}
async function extractZip(params) {
    const limits = resolveExtractLimits(params.limits);
    const destinationRealDir = await prepareArchiveDestinationDir(params.destDir);
    const stat = await fs.stat(params.archivePath);
    if (stat.size > limits.maxArchiveBytes) {
        throw new Error(ERROR_ARCHIVE_SIZE_EXCEEDS_LIMIT);
    }
    const buffer = await fs.readFile(params.archivePath);
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files);
    const strip = Math.max(0, Math.floor(params.stripComponents ?? 0));
    assertArchiveEntryCountWithinLimit(entries.length, limits);
    const budget = createByteBudgetTracker(limits);
    for (const entry of entries) {
        const output = resolveZipOutputPath({
            entryPath: entry.name,
            strip,
            destinationDir: params.destDir,
        });
        if (!output) {
            continue;
        }
        await prepareZipOutputPath({
            destinationDir: params.destDir,
            destinationRealDir,
            relPath: output.relPath,
            outPath: output.outPath,
            originalPath: entry.name,
            isDirectory: entry.dir,
        });
        if (entry.dir) {
            continue;
        }
        await writeZipFileEntry({
            entry,
            relPath: output.relPath,
            destinationRealDir,
            budget,
        });
    }
}
const BLOCKED_TAR_ENTRY_TYPES = new Set([
    "SymbolicLink",
    "Link",
    "BlockDevice",
    "CharacterDevice",
    "FIFO",
    "Socket",
]);
function readTarEntryInfo(entry) {
    const p = typeof entry === "object" && entry !== null && "path" in entry
        ? String(entry.path)
        : "";
    const t = typeof entry === "object" && entry !== null && "type" in entry
        ? String(entry.type)
        : "";
    const s = typeof entry === "object" &&
        entry !== null &&
        "size" in entry &&
        typeof entry.size === "number" &&
        Number.isFinite(entry.size)
        ? Math.max(0, Math.floor(entry.size))
        : 0;
    return { path: p, type: t, size: s };
}
export function createTarEntryPreflightChecker(params) {
    const strip = Math.max(0, Math.floor(params.stripComponents ?? 0));
    const limits = resolveExtractLimits(params.limits);
    let entryCount = 0;
    const budget = createByteBudgetTracker(limits);
    return (entry) => {
        validateArchiveEntryPath(entry.path, { escapeLabel: params.escapeLabel });
        const relPath = stripArchivePath(entry.path, strip);
        if (!relPath) {
            return;
        }
        validateArchiveEntryPath(relPath, { escapeLabel: params.escapeLabel });
        resolveArchiveOutputPath({
            rootDir: params.rootDir,
            relPath,
            originalPath: entry.path,
            escapeLabel: params.escapeLabel,
        });
        if (BLOCKED_TAR_ENTRY_TYPES.has(entry.type)) {
            throw new Error(`tar entry is a link: ${entry.path}`);
        }
        entryCount += 1;
        assertArchiveEntryCountWithinLimit(entryCount, limits);
        budget.addEntrySize(entry.size);
    };
}
export async function extractArchive(params) {
    const kind = params.kind ?? resolveArchiveKind(params.archivePath);
    if (!kind) {
        throw new Error(`unsupported archive: ${params.archivePath}`);
    }
    const label = kind === "zip" ? "extract zip" : "extract tar";
    if (kind === "tar") {
        await withTimeout((async () => {
            const limits = resolveExtractLimits(params.limits);
            const stat = await fs.stat(params.archivePath);
            if (stat.size > limits.maxArchiveBytes) {
                throw new Error(ERROR_ARCHIVE_SIZE_EXCEEDS_LIMIT);
            }
            const destinationRealDir = await prepareArchiveDestinationDir(params.destDir);
            await withStagedArchiveDestination({
                destinationRealDir,
                run: async (stagingDir) => {
                    const checkTarEntrySafety = createTarEntryPreflightChecker({
                        rootDir: destinationRealDir,
                        stripComponents: params.stripComponents,
                        limits,
                    });
                    // A canonical cwd is not enough here: tar can still follow
                    // pre-existing child symlinks in the live destination tree.
                    // Extract into a private staging dir first, then merge through
                    // the same safe-open boundary checks used by direct file writes.
                    await tar.x({
                        file: params.archivePath,
                        cwd: stagingDir,
                        strip: Math.max(0, Math.floor(params.stripComponents ?? 0)),
                        gzip: params.tarGzip,
                        preservePaths: false,
                        strict: true,
                        onReadEntry(entry) {
                            try {
                                checkTarEntrySafety(readTarEntryInfo(entry));
                            }
                            catch (err) {
                                const error = err instanceof Error ? err : new Error(String(err));
                                // Node's EventEmitter calls listeners with `this` bound to the
                                // emitter (tar.Unpack), which exposes Parser.abort().
                                const emitter = this;
                                emitter.abort?.(error);
                            }
                        },
                    });
                    await mergeExtractedTreeIntoDestination({
                        sourceDir: stagingDir,
                        destinationDir: destinationRealDir,
                        destinationRealDir,
                    });
                },
            });
        })(), params.timeoutMs, label);
        return;
    }
    await withTimeout(extractZip({
        archivePath: params.archivePath,
        destDir: params.destDir,
        stripComponents: params.stripComponents,
        limits: params.limits,
    }), params.timeoutMs, label);
}
export async function fileExists(filePath) {
    try {
        await fs.stat(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export async function readJsonFile(filePath) {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
}
