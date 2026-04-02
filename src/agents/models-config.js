import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimeConfigSourceSnapshot, projectConfigOntoRuntimeSourceSnapshot, loadConfig, } from "../config/config.js";
import { createConfigRuntimeEnv } from "../config/env-vars.js";
import { resolveOpenClawAgentDir } from "./agent-paths.js";
import { planOpenClawModelsJson } from "./models-config.plan.js";
const MODELS_JSON_WRITE_LOCKS = new Map();
const MODELS_JSON_READY_CACHE = new Map();
async function readFileMtimeMs(pathname) {
    try {
        const stat = await fs.stat(pathname);
        return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
    }
    catch {
        return null;
    }
}
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
    }
    const entries = Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b));
    return `{${entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
        .join(",")}}`;
}
async function buildModelsJsonFingerprint(params) {
    const authProfilesMtimeMs = await readFileMtimeMs(path.join(params.agentDir, "auth-profiles.json"));
    const modelsFileMtimeMs = await readFileMtimeMs(path.join(params.agentDir, "models.json"));
    const envShape = createConfigRuntimeEnv(params.config, {});
    return stableStringify({
        config: params.config,
        sourceConfigForSecrets: params.sourceConfigForSecrets,
        envShape,
        authProfilesMtimeMs,
        modelsFileMtimeMs,
    });
}
async function readExistingModelsFile(pathname) {
    try {
        const raw = await fs.readFile(pathname, "utf8");
        return {
            raw,
            parsed: JSON.parse(raw),
        };
    }
    catch {
        return {
            raw: "",
            parsed: null,
        };
    }
}
async function ensureModelsFileMode(pathname) {
    await fs.chmod(pathname, 0o600).catch(() => {
        // best-effort
    });
}
async function writeModelsFileAtomic(targetPath, contents) {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, contents, { mode: 0o600 });
    await fs.rename(tempPath, targetPath);
}
function resolveModelsConfigInput(config) {
    const runtimeSource = getRuntimeConfigSourceSnapshot();
    if (!config) {
        const loaded = loadConfig();
        return {
            config: runtimeSource ?? loaded,
            sourceConfigForSecrets: runtimeSource ?? loaded,
        };
    }
    if (!runtimeSource) {
        return {
            config,
            sourceConfigForSecrets: config,
        };
    }
    const projected = projectConfigOntoRuntimeSourceSnapshot(config);
    return {
        config: projected,
        // If projection is skipped (for example incompatible top-level shape),
        // keep managed secret persistence anchored to the active source snapshot.
        sourceConfigForSecrets: projected === config ? runtimeSource : projected,
    };
}
async function withModelsJsonWriteLock(targetPath, run) {
    const prior = MODELS_JSON_WRITE_LOCKS.get(targetPath) ?? Promise.resolve();
    let release = () => { };
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const pending = prior.then(() => gate);
    MODELS_JSON_WRITE_LOCKS.set(targetPath, pending);
    try {
        await prior;
        return await run();
    }
    finally {
        release();
        if (MODELS_JSON_WRITE_LOCKS.get(targetPath) === pending) {
            MODELS_JSON_WRITE_LOCKS.delete(targetPath);
        }
    }
}
export async function ensureOpenClawModelsJson(config, agentDirOverride) {
    const resolved = resolveModelsConfigInput(config);
    const cfg = resolved.config;
    const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveOpenClawAgentDir();
    const targetPath = path.join(agentDir, "models.json");
    const fingerprint = await buildModelsJsonFingerprint({
        config: cfg,
        sourceConfigForSecrets: resolved.sourceConfigForSecrets,
        agentDir,
    });
    const cached = MODELS_JSON_READY_CACHE.get(targetPath);
    if (cached) {
        const settled = await cached;
        if (settled.fingerprint === fingerprint) {
            await ensureModelsFileMode(targetPath);
            return settled.result;
        }
    }
    const pending = withModelsJsonWriteLock(targetPath, async () => {
        // Ensure config env vars (e.g. AWS_PROFILE, AWS_ACCESS_KEY_ID) are
        // are available to provider discovery without mutating process.env.
        const env = createConfigRuntimeEnv(cfg);
        const existingModelsFile = await readExistingModelsFile(targetPath);
        const plan = await planOpenClawModelsJson({
            cfg,
            sourceConfigForSecrets: resolved.sourceConfigForSecrets,
            agentDir,
            env,
            existingRaw: existingModelsFile.raw,
            existingParsed: existingModelsFile.parsed,
        });
        if (plan.action === "skip") {
            return { fingerprint, result: { agentDir, wrote: false } };
        }
        if (plan.action === "noop") {
            await ensureModelsFileMode(targetPath);
            return { fingerprint, result: { agentDir, wrote: false } };
        }
        await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
        await writeModelsFileAtomic(targetPath, plan.contents);
        await ensureModelsFileMode(targetPath);
        return { fingerprint, result: { agentDir, wrote: true } };
    });
    MODELS_JSON_READY_CACHE.set(targetPath, pending);
    try {
        const settled = await pending;
        return settled.result;
    }
    catch (error) {
        if (MODELS_JSON_READY_CACHE.get(targetPath) === pending) {
            MODELS_JSON_READY_CACHE.delete(targetPath);
        }
        throw error;
    }
}
export function resetModelsJsonReadyCacheForTest() {
    MODELS_JSON_READY_CACHE.clear();
}
