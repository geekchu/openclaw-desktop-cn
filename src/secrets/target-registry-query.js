import { getPath } from "./path-utils.js";
import { SECRET_TARGET_REGISTRY } from "./target-registry-data.js";
import { compileTargetRegistryEntry, expandPathTokens, materializePathTokens, matchPathTokens, } from "./target-registry-pattern.js";
const COMPILED_SECRET_TARGET_REGISTRY = SECRET_TARGET_REGISTRY.map(compileTargetRegistryEntry);
const OPENCLAW_COMPILED_SECRET_TARGETS = COMPILED_SECRET_TARGET_REGISTRY.filter((entry) => entry.configFile === "openclaw.json");
const AUTH_PROFILES_COMPILED_SECRET_TARGETS = COMPILED_SECRET_TARGET_REGISTRY.filter((entry) => entry.configFile === "auth-profiles.json");
function buildTargetTypeIndex() {
    const byType = new Map();
    const append = (type, entry) => {
        const existing = byType.get(type);
        if (existing) {
            existing.push(entry);
            return;
        }
        byType.set(type, [entry]);
    };
    for (const entry of COMPILED_SECRET_TARGET_REGISTRY) {
        append(entry.targetType, entry);
        for (const alias of entry.targetTypeAliases ?? []) {
            append(alias, entry);
        }
    }
    return byType;
}
const TARGETS_BY_TYPE = buildTargetTypeIndex();
const KNOWN_TARGET_IDS = new Set(COMPILED_SECRET_TARGET_REGISTRY.map((entry) => entry.id));
function buildConfigTargetIdIndex() {
    const byId = new Map();
    for (const entry of OPENCLAW_COMPILED_SECRET_TARGETS) {
        const existing = byId.get(entry.id);
        if (existing) {
            existing.push(entry);
            continue;
        }
        byId.set(entry.id, [entry]);
    }
    return byId;
}
const OPENCLAW_TARGETS_BY_ID = buildConfigTargetIdIndex();
function buildAuthProfileTargetIdIndex() {
    const byId = new Map();
    for (const entry of AUTH_PROFILES_COMPILED_SECRET_TARGETS) {
        const existing = byId.get(entry.id);
        if (existing) {
            existing.push(entry);
            continue;
        }
        byId.set(entry.id, [entry]);
    }
    return byId;
}
const AUTH_PROFILES_TARGETS_BY_ID = buildAuthProfileTargetIdIndex();
function normalizeAllowedTargetIds(targetIds) {
    if (targetIds === undefined) {
        return null;
    }
    return new Set(Array.from(targetIds)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0));
}
function resolveDiscoveryEntries(params) {
    if (params.allowedTargetIds === null) {
        return params.defaultEntries;
    }
    return Array.from(params.allowedTargetIds).flatMap((targetId) => params.entriesById.get(targetId) ?? []);
}
function discoverSecretTargetsFromEntries(source, discoveryEntries) {
    const out = [];
    const seen = new Set();
    for (const entry of discoveryEntries) {
        const expanded = expandPathTokens(source, entry.pathTokens);
        for (const match of expanded) {
            const resolved = toResolvedPlanTarget(entry, match.segments, match.captures);
            if (!resolved) {
                continue;
            }
            const key = `${entry.id}:${resolved.pathSegments.join(".")}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const refValue = resolved.refPathSegments
                ? getPath(source, resolved.refPathSegments)
                : undefined;
            out.push({
                entry,
                path: resolved.pathSegments.join("."),
                pathSegments: resolved.pathSegments,
                ...(resolved.refPathSegments
                    ? {
                        refPathSegments: resolved.refPathSegments,
                        refPath: resolved.refPathSegments.join("."),
                    }
                    : {}),
                value: match.value,
                ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
                ...(resolved.accountId ? { accountId: resolved.accountId } : {}),
                ...(resolved.refPathSegments ? { refValue } : {}),
            });
        }
    }
    return out;
}
function toResolvedPlanTarget(entry, pathSegments, captures) {
    const providerId = entry.providerIdPathSegmentIndex !== undefined
        ? pathSegments[entry.providerIdPathSegmentIndex]
        : undefined;
    const accountId = entry.accountIdPathSegmentIndex !== undefined
        ? pathSegments[entry.accountIdPathSegmentIndex]
        : undefined;
    const refPathSegments = entry.refPathTokens
        ? materializePathTokens(entry.refPathTokens, captures)
        : undefined;
    if (entry.refPathTokens && !refPathSegments) {
        return null;
    }
    return {
        entry,
        pathSegments,
        ...(refPathSegments ? { refPathSegments } : {}),
        ...(providerId ? { providerId } : {}),
        ...(accountId ? { accountId } : {}),
    };
}
export function listSecretTargetRegistryEntries() {
    return COMPILED_SECRET_TARGET_REGISTRY.map((entry) => ({
        id: entry.id,
        targetType: entry.targetType,
        ...(entry.targetTypeAliases ? { targetTypeAliases: [...entry.targetTypeAliases] } : {}),
        configFile: entry.configFile,
        pathPattern: entry.pathPattern,
        ...(entry.refPathPattern ? { refPathPattern: entry.refPathPattern } : {}),
        secretShape: entry.secretShape,
        expectedResolvedValue: entry.expectedResolvedValue,
        includeInPlan: entry.includeInPlan,
        includeInConfigure: entry.includeInConfigure,
        includeInAudit: entry.includeInAudit,
        ...(entry.providerIdPathSegmentIndex !== undefined
            ? { providerIdPathSegmentIndex: entry.providerIdPathSegmentIndex }
            : {}),
        ...(entry.accountIdPathSegmentIndex !== undefined
            ? { accountIdPathSegmentIndex: entry.accountIdPathSegmentIndex }
            : {}),
        ...(entry.authProfileType ? { authProfileType: entry.authProfileType } : {}),
        ...(entry.trackProviderShadowing ? { trackProviderShadowing: true } : {}),
    }));
}
export function isKnownSecretTargetType(value) {
    return typeof value === "string" && TARGETS_BY_TYPE.has(value);
}
export function isKnownSecretTargetId(value) {
    return typeof value === "string" && KNOWN_TARGET_IDS.has(value);
}
export function resolvePlanTargetAgainstRegistry(candidate) {
    const entries = TARGETS_BY_TYPE.get(candidate.type);
    if (!entries || entries.length === 0) {
        return null;
    }
    for (const entry of entries) {
        if (!entry.includeInPlan) {
            continue;
        }
        const matched = matchPathTokens(candidate.pathSegments, entry.pathTokens);
        if (!matched) {
            continue;
        }
        const resolved = toResolvedPlanTarget(entry, candidate.pathSegments, matched.captures);
        if (!resolved) {
            continue;
        }
        if (candidate.providerId && candidate.providerId.trim().length > 0) {
            if (!resolved.providerId || resolved.providerId !== candidate.providerId) {
                continue;
            }
        }
        if (candidate.accountId && candidate.accountId.trim().length > 0) {
            if (!resolved.accountId || resolved.accountId !== candidate.accountId) {
                continue;
            }
        }
        return resolved;
    }
    return null;
}
export function resolveConfigSecretTargetByPath(pathSegments) {
    for (const entry of OPENCLAW_COMPILED_SECRET_TARGETS) {
        if (!entry.includeInPlan) {
            continue;
        }
        const matched = matchPathTokens(pathSegments, entry.pathTokens);
        if (!matched) {
            continue;
        }
        const resolved = toResolvedPlanTarget(entry, pathSegments, matched.captures);
        if (!resolved) {
            continue;
        }
        return resolved;
    }
    return null;
}
export function discoverConfigSecretTargets(config) {
    return discoverConfigSecretTargetsByIds(config);
}
export function discoverConfigSecretTargetsByIds(config, targetIds) {
    const allowedTargetIds = normalizeAllowedTargetIds(targetIds);
    const discoveryEntries = resolveDiscoveryEntries({
        allowedTargetIds,
        defaultEntries: OPENCLAW_COMPILED_SECRET_TARGETS,
        entriesById: OPENCLAW_TARGETS_BY_ID,
    });
    return discoverSecretTargetsFromEntries(config, discoveryEntries);
}
export function discoverAuthProfileSecretTargets(store) {
    return discoverAuthProfileSecretTargetsByIds(store);
}
export function discoverAuthProfileSecretTargetsByIds(store, targetIds) {
    const allowedTargetIds = normalizeAllowedTargetIds(targetIds);
    const discoveryEntries = resolveDiscoveryEntries({
        allowedTargetIds,
        defaultEntries: AUTH_PROFILES_COMPILED_SECRET_TARGETS,
        entriesById: AUTH_PROFILES_TARGETS_BY_ID,
    });
    return discoverSecretTargetsFromEntries(store, discoveryEntries);
}
export function listAuthProfileSecretTargetEntries() {
    return COMPILED_SECRET_TARGET_REGISTRY.filter((entry) => entry.configFile === "auth-profiles.json" && entry.includeInAudit);
}
