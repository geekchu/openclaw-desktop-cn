import { Type } from "@sinclair/typebox";
import { isRestartEnabled } from "../../config/commands.js";
import { parseConfigJson5, resolveConfigSnapshotHash } from "../../config/io.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import { extractDeliveryInfo } from "../../config/sessions.js";
import { formatDoctorNonInteractiveHint, writeRestartSentinel, } from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
const log = createSubsystemLogger("gateway-tool");
const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;
const PROTECTED_GATEWAY_CONFIG_PATHS = ["tools.exec.ask", "tools.exec.security"];
function resolveBaseHashFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
        return undefined;
    }
    const hashValue = snapshot.hash;
    const rawValue = snapshot.raw;
    const hash = resolveConfigSnapshotHash({
        hash: typeof hashValue === "string" ? hashValue : undefined,
        raw: typeof rawValue === "string" ? rawValue : undefined,
    });
    return hash ?? undefined;
}
function getSnapshotConfig(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
        throw new Error("config.get response is not an object.");
    }
    const config = snapshot.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("config.get response is missing a config object.");
    }
    return config;
}
function parseGatewayConfigMutationRaw(raw, action) {
    const parsedRes = parseConfigJson5(raw);
    if (!parsedRes.ok) {
        throw new Error(parsedRes.error);
    }
    if (!parsedRes.parsed ||
        typeof parsedRes.parsed !== "object" ||
        Array.isArray(parsedRes.parsed)) {
        throw new Error(`${action} raw must be an object.`);
    }
    return parsedRes.parsed;
}
function getValueAtPath(config, path) {
    let current = config;
    for (const part of path.split(".")) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}
function assertGatewayConfigMutationAllowed(params) {
    const parsed = parseGatewayConfigMutationRaw(params.raw, params.action);
    const nextConfig = params.action === "config.apply"
        ? parsed
        : applyMergePatch(params.currentConfig, parsed, {
            mergeObjectArraysById: true,
        });
    const migratedNextConfig = applyLegacyMigrations(nextConfig).next ?? nextConfig;
    const changedProtectedPaths = PROTECTED_GATEWAY_CONFIG_PATHS.filter((path) => getValueAtPath(params.currentConfig, path) !== getValueAtPath(migratedNextConfig, path));
    if (changedProtectedPaths.length === 0) {
        return;
    }
    throw new Error(`gateway ${params.action} cannot change protected config paths: ${changedProtectedPaths.join(", ")}`);
}
const GATEWAY_ACTIONS = [
    "restart",
    "config.get",
    "config.schema.lookup",
    "config.apply",
    "config.patch",
    "update.run",
];
// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
    action: stringEnum(GATEWAY_ACTIONS),
    // restart
    delayMs: Type.Optional(Type.Number()),
    reason: Type.Optional(Type.String()),
    // config.get, config.schema.lookup, config.apply, update.run
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    // config.schema.lookup
    path: Type.Optional(Type.String()),
    // config.apply, config.patch
    raw: Type.Optional(Type.String()),
    baseHash: Type.Optional(Type.String()),
    // config.apply, config.patch, update.run
    sessionKey: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
    restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.
export function createGatewayTool(opts) {
    return {
        label: "Gateway",
        name: "gateway",
        ownerOnly: true,
        description: "Restart, inspect a specific config schema path, apply config, or update the gateway in-place (SIGUSR1). Use config.schema.lookup with a targeted dot path before config edits. Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing. Always pass a human-readable completion message via the `note` parameter so the system can deliver it to the user after restart.",
        parameters: GatewayToolSchema,
        execute: async (_toolCallId, args) => {
            const params = args;
            const action = readStringParam(params, "action", { required: true });
            if (action === "restart") {
                if (!isRestartEnabled(opts?.config)) {
                    throw new Error("Gateway restart is disabled (commands.restart=false).");
                }
                const sessionKey = typeof params.sessionKey === "string" && params.sessionKey.trim()
                    ? params.sessionKey.trim()
                    : opts?.agentSessionKey?.trim() || undefined;
                const delayMs = typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
                    ? Math.floor(params.delayMs)
                    : undefined;
                const reason = typeof params.reason === "string" && params.reason.trim()
                    ? params.reason.trim().slice(0, 200)
                    : undefined;
                const note = typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
                // Extract channel + threadId for routing after restart
                // Supports both :thread: (most channels) and :topic: (Telegram)
                const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);
                const payload = {
                    kind: "restart",
                    status: "ok",
                    ts: Date.now(),
                    sessionKey,
                    deliveryContext,
                    threadId,
                    message: note ?? reason ?? null,
                    doctorHint: formatDoctorNonInteractiveHint(),
                    stats: {
                        mode: "gateway.restart",
                        reason,
                    },
                };
                try {
                    await writeRestartSentinel(payload);
                }
                catch {
                    // ignore: sentinel is best-effort
                }
                log.info(`gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`);
                const scheduled = scheduleGatewaySigusr1Restart({
                    delayMs,
                    reason,
                });
                return jsonResult(scheduled);
            }
            const gatewayOpts = readGatewayCallOptions(params);
            const resolveGatewayWriteMeta = () => {
                const sessionKey = typeof params.sessionKey === "string" && params.sessionKey.trim()
                    ? params.sessionKey.trim()
                    : opts?.agentSessionKey?.trim() || undefined;
                const note = typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
                const restartDelayMs = typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
                    ? Math.floor(params.restartDelayMs)
                    : undefined;
                return { sessionKey, note, restartDelayMs };
            };
            const resolveConfigWriteParams = async () => {
                const raw = readStringParam(params, "raw", { required: true });
                const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
                // Always fetch config.get so we can compare protected exec settings
                // against the current snapshot before forwarding any write RPC.
                const snapshotConfig = getSnapshotConfig(snapshot);
                let baseHash = readStringParam(params, "baseHash");
                if (!baseHash) {
                    baseHash = resolveBaseHashFromSnapshot(snapshot);
                }
                if (!baseHash) {
                    throw new Error("Missing baseHash from config snapshot.");
                }
                return { raw, baseHash, snapshotConfig, ...resolveGatewayWriteMeta() };
            };
            if (action === "config.get") {
                const result = await callGatewayTool("config.get", gatewayOpts, {});
                return jsonResult({ ok: true, result });
            }
            if (action === "config.schema.lookup") {
                const path = readStringParam(params, "path", {
                    required: true,
                    label: "path",
                });
                const result = await callGatewayTool("config.schema.lookup", gatewayOpts, { path });
                return jsonResult({ ok: true, result });
            }
            if (action === "config.apply") {
                const { raw, baseHash, snapshotConfig, sessionKey, note, restartDelayMs } = await resolveConfigWriteParams();
                assertGatewayConfigMutationAllowed({
                    action: "config.apply",
                    currentConfig: snapshotConfig,
                    raw,
                });
                const result = await callGatewayTool("config.apply", gatewayOpts, {
                    raw,
                    baseHash,
                    sessionKey,
                    note,
                    restartDelayMs,
                });
                return jsonResult({ ok: true, result });
            }
            if (action === "config.patch") {
                const { raw, baseHash, snapshotConfig, sessionKey, note, restartDelayMs } = await resolveConfigWriteParams();
                assertGatewayConfigMutationAllowed({
                    action: "config.patch",
                    currentConfig: snapshotConfig,
                    raw,
                });
                const result = await callGatewayTool("config.patch", gatewayOpts, {
                    raw,
                    baseHash,
                    sessionKey,
                    note,
                    restartDelayMs,
                });
                return jsonResult({ ok: true, result });
            }
            if (action === "update.run") {
                const { sessionKey, note, restartDelayMs } = resolveGatewayWriteMeta();
                const updateTimeoutMs = gatewayOpts.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
                const updateGatewayOpts = {
                    ...gatewayOpts,
                    timeoutMs: updateTimeoutMs,
                };
                const result = await callGatewayTool("update.run", updateGatewayOpts, {
                    sessionKey,
                    note,
                    restartDelayMs,
                    timeoutMs: updateTimeoutMs,
                });
                return jsonResult({ ok: true, result });
            }
            throw new Error(`Unknown action: ${action}`);
        },
    };
}
