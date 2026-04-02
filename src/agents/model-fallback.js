import { resolveAgentModelFallbackValues, resolveAgentModelPrimaryValue, } from "../config/model-input.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { sanitizeForLog } from "../terminal/ansi.js";
import { ensureAuthProfileStore, getSoonestCooldownExpiry, isProfileInCooldown, loadAuthProfileStoreForRuntime, resolveProfilesUnavailableReason, resolveAuthProfileOrder, } from "./auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { coerceToFailoverError, describeFailoverError, isFailoverError, isTimeoutError, } from "./failover-error.js";
import { shouldAllowCooldownProbeForReason, shouldPreserveTransientCooldownProbeSlot, shouldUseTransientCooldownProbeSlot, } from "./failover-policy.js";
import { logModelFallbackDecision } from "./model-fallback-observation.js";
import { buildConfiguredAllowlistKeys, buildModelAliasIndex, modelKey, normalizeModelRef, resolveConfiguredModelRef, resolveModelRefFromString, } from "./model-selection.js";
import { isLikelyContextOverflowError } from "./pi-embedded-helpers.js";
const log = createSubsystemLogger("model-fallback");
/**
 * Structured error thrown when all model fallback candidates have been
 * exhausted. Carries per-attempt details so callers can build informative
 * user-facing messages (e.g. "rate-limited, retry in 30 s").
 */
export class FallbackSummaryError extends Error {
    attempts;
    soonestCooldownExpiry;
    constructor(message, attempts, soonestCooldownExpiry, cause) {
        super(message, { cause });
        this.name = "FallbackSummaryError";
        this.attempts = attempts;
        this.soonestCooldownExpiry = soonestCooldownExpiry;
    }
}
export function isFallbackSummaryError(err) {
    return err instanceof FallbackSummaryError;
}
/**
 * Fallback abort check. Only treats explicit AbortError names as user aborts.
 * Message-based checks (e.g., "aborted") can mask timeouts and skip fallback.
 */
function isFallbackAbortError(err) {
    if (!err || typeof err !== "object") {
        return false;
    }
    if (isFailoverError(err)) {
        return false;
    }
    const name = "name" in err ? String(err.name) : "";
    return name === "AbortError";
}
function shouldRethrowAbort(err) {
    return isFallbackAbortError(err) && !isTimeoutError(err);
}
function createModelCandidateCollector(allowlist) {
    const seen = new Set();
    const candidates = [];
    const addCandidate = (candidate, enforceAllowlist) => {
        if (!candidate.provider || !candidate.model) {
            return;
        }
        const key = modelKey(candidate.provider, candidate.model);
        if (seen.has(key)) {
            return;
        }
        if (enforceAllowlist && allowlist && !allowlist.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push(candidate);
    };
    const addExplicitCandidate = (candidate) => {
        addCandidate(candidate, false);
    };
    const addAllowlistedCandidate = (candidate) => {
        addCandidate(candidate, true);
    };
    return { candidates, addExplicitCandidate, addAllowlistedCandidate };
}
function buildFallbackSuccess(params) {
    return {
        result: params.result,
        provider: params.provider,
        model: params.model,
        attempts: params.attempts,
    };
}
async function runFallbackCandidate(params) {
    try {
        const result = params.options
            ? await params.run(params.provider, params.model, params.options)
            : await params.run(params.provider, params.model);
        return {
            ok: true,
            result,
        };
    }
    catch (err) {
        // Normalize abort-wrapped rate-limit errors (e.g. Google Vertex RESOURCE_EXHAUSTED)
        // so they become FailoverErrors and continue the fallback loop instead of aborting.
        const normalizedFailover = coerceToFailoverError(err, {
            provider: params.provider,
            model: params.model,
        });
        if (shouldRethrowAbort(err) && !normalizedFailover) {
            throw err;
        }
        return { ok: false, error: normalizedFailover ?? err };
    }
}
async function runFallbackAttempt(params) {
    const runResult = await runFallbackCandidate({
        run: params.run,
        provider: params.provider,
        model: params.model,
        options: params.options,
    });
    if (runResult.ok) {
        return {
            success: buildFallbackSuccess({
                result: runResult.result,
                provider: params.provider,
                model: params.model,
                attempts: params.attempts,
            }),
        };
    }
    return { error: runResult.error };
}
function sameModelCandidate(a, b) {
    return a.provider === b.provider && a.model === b.model;
}
function throwFallbackFailureSummary(params) {
    if (params.attempts.length <= 1 && params.lastError) {
        throw params.lastError;
    }
    const summary = params.attempts.length > 0 ? params.attempts.map(params.formatAttempt).join(" | ") : "unknown";
    throw new FallbackSummaryError(`All ${params.label} failed (${params.attempts.length || params.candidates.length}): ${summary}`, params.attempts, params.soonestCooldownExpiry ?? null, params.lastError instanceof Error ? params.lastError : undefined);
}
function resolveFallbackSoonestCooldownExpiry(params) {
    if (!params.authStore) {
        return null;
    }
    // Refresh from persisted state because embedded attempts can update auth
    // cooldowns through a separate store instance while the fallback loop runs.
    const refreshedStore = loadAuthProfileStoreForRuntime(params.agentDir, {
        readOnly: true,
        allowKeychainPrompt: false,
    });
    let soonest = null;
    for (const candidate of params.candidates) {
        const ids = resolveAuthProfileOrder({
            cfg: params.cfg,
            store: refreshedStore,
            provider: candidate.provider,
        });
        const candidateSoonest = getSoonestCooldownExpiry(refreshedStore, ids, {
            forModel: candidate.model,
        });
        if (typeof candidateSoonest === "number" &&
            Number.isFinite(candidateSoonest) &&
            (soonest === null || candidateSoonest < soonest)) {
            soonest = candidateSoonest;
        }
    }
    return soonest;
}
function resolveImageFallbackCandidates(params) {
    const aliasIndex = buildModelAliasIndex({
        cfg: params.cfg ?? {},
        defaultProvider: params.defaultProvider,
    });
    const allowlist = buildConfiguredAllowlistKeys({
        cfg: params.cfg,
        defaultProvider: params.defaultProvider,
    });
    const { candidates, addExplicitCandidate, addAllowlistedCandidate } = createModelCandidateCollector(allowlist);
    const addRaw = (raw, opts) => {
        const resolved = resolveModelRefFromString({
            raw: String(raw ?? ""),
            defaultProvider: params.defaultProvider,
            aliasIndex,
        });
        if (!resolved) {
            return;
        }
        if (opts?.allowlist) {
            addAllowlistedCandidate(resolved.ref);
            return;
        }
        addExplicitCandidate(resolved.ref);
    };
    if (params.modelOverride?.trim()) {
        addRaw(params.modelOverride);
    }
    else {
        const primary = resolveAgentModelPrimaryValue(params.cfg?.agents?.defaults?.imageModel);
        if (primary?.trim()) {
            addRaw(primary);
        }
    }
    const imageFallbacks = resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.imageModel);
    for (const raw of imageFallbacks) {
        // Explicitly configured image fallbacks should remain reachable even when a
        // model allowlist is present.
        addRaw(raw);
    }
    return candidates;
}
function resolveFallbackCandidates(params) {
    const primary = params.cfg
        ? resolveConfiguredModelRef({
            cfg: params.cfg,
            defaultProvider: DEFAULT_PROVIDER,
            defaultModel: DEFAULT_MODEL,
        })
        : null;
    const defaultProvider = primary?.provider ?? DEFAULT_PROVIDER;
    const defaultModel = primary?.model ?? DEFAULT_MODEL;
    const providerRaw = String(params.provider ?? "").trim() || defaultProvider;
    const modelRaw = String(params.model ?? "").trim() || defaultModel;
    const normalizedPrimary = normalizeModelRef(providerRaw, modelRaw);
    const configuredPrimary = normalizeModelRef(defaultProvider, defaultModel);
    const aliasIndex = buildModelAliasIndex({
        cfg: params.cfg ?? {},
        defaultProvider,
    });
    const allowlist = buildConfiguredAllowlistKeys({
        cfg: params.cfg,
        defaultProvider,
    });
    const { candidates, addExplicitCandidate } = createModelCandidateCollector(allowlist);
    addExplicitCandidate(normalizedPrimary);
    const modelFallbacks = (() => {
        if (params.fallbacksOverride !== undefined) {
            return params.fallbacksOverride;
        }
        const configuredFallbacks = resolveAgentModelFallbackValues(params.cfg?.agents?.defaults?.model);
        // When user runs a different provider than config, only use configured fallbacks
        // if the current model is already in that chain (e.g. session on first fallback).
        if (normalizedPrimary.provider !== configuredPrimary.provider) {
            const isConfiguredFallback = configuredFallbacks.some((raw) => {
                const resolved = resolveModelRefFromString({
                    raw: String(raw ?? ""),
                    defaultProvider,
                    aliasIndex,
                });
                return resolved ? sameModelCandidate(resolved.ref, normalizedPrimary) : false;
            });
            return isConfiguredFallback ? configuredFallbacks : [];
        }
        // Same provider: always use full fallback chain (model version differences within provider).
        return configuredFallbacks;
    })();
    for (const raw of modelFallbacks) {
        const resolved = resolveModelRefFromString({
            raw: String(raw ?? ""),
            defaultProvider,
            aliasIndex,
        });
        if (!resolved) {
            continue;
        }
        // Fallbacks are explicit user intent; do not silently filter them by the
        // model allowlist.
        addExplicitCandidate(resolved.ref);
    }
    if (params.fallbacksOverride === undefined && primary?.provider && primary.model) {
        addExplicitCandidate({ provider: primary.provider, model: primary.model });
    }
    return candidates;
}
const lastProbeAttempt = new Map();
const MIN_PROBE_INTERVAL_MS = 30_000; // 30 seconds between probes per key
const PROBE_MARGIN_MS = 2 * 60 * 1000;
const PROBE_SCOPE_DELIMITER = "::";
const PROBE_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROBE_KEYS = 256;
function resolveProbeThrottleKey(provider, agentDir) {
    const scope = String(agentDir ?? "").trim();
    return scope ? `${scope}${PROBE_SCOPE_DELIMITER}${provider}` : provider;
}
function pruneProbeState(now) {
    for (const [key, ts] of lastProbeAttempt) {
        if (!Number.isFinite(ts) || ts <= 0 || now - ts > PROBE_STATE_TTL_MS) {
            lastProbeAttempt.delete(key);
        }
    }
}
function enforceProbeStateCap() {
    while (lastProbeAttempt.size > MAX_PROBE_KEYS) {
        let oldestKey = null;
        let oldestTs = Number.POSITIVE_INFINITY;
        for (const [key, ts] of lastProbeAttempt) {
            if (ts < oldestTs) {
                oldestKey = key;
                oldestTs = ts;
            }
        }
        if (!oldestKey) {
            break;
        }
        lastProbeAttempt.delete(oldestKey);
    }
}
function isProbeThrottleOpen(now, throttleKey) {
    pruneProbeState(now);
    const lastProbe = lastProbeAttempt.get(throttleKey) ?? 0;
    return now - lastProbe >= MIN_PROBE_INTERVAL_MS;
}
function markProbeAttempt(now, throttleKey) {
    pruneProbeState(now);
    lastProbeAttempt.set(throttleKey, now);
    enforceProbeStateCap();
}
function shouldProbePrimaryDuringCooldown(params) {
    if (!params.isPrimary || !params.hasFallbackCandidates) {
        return false;
    }
    if (!isProbeThrottleOpen(params.now, params.throttleKey)) {
        return false;
    }
    const soonest = getSoonestCooldownExpiry(params.authStore, params.profileIds, {
        now: params.now,
        forModel: params.model,
    });
    if (soonest === null || !Number.isFinite(soonest)) {
        return true;
    }
    // Probe when cooldown already expired or within the configured margin.
    return params.now >= soonest - PROBE_MARGIN_MS;
}
/** @internal – exposed for unit tests only */
export const _probeThrottleInternals = {
    lastProbeAttempt,
    MIN_PROBE_INTERVAL_MS,
    PROBE_MARGIN_MS,
    PROBE_STATE_TTL_MS,
    MAX_PROBE_KEYS,
    resolveProbeThrottleKey,
    isProbeThrottleOpen,
    pruneProbeState,
    markProbeAttempt,
};
function resolveCooldownDecision(params) {
    const shouldProbe = shouldProbePrimaryDuringCooldown({
        isPrimary: params.isPrimary,
        hasFallbackCandidates: params.hasFallbackCandidates,
        now: params.now,
        throttleKey: params.probeThrottleKey,
        authStore: params.authStore,
        profileIds: params.profileIds,
        model: params.candidate.model,
    });
    const inferredReason = resolveProfilesUnavailableReason({
        store: params.authStore,
        profileIds: params.profileIds,
        now: params.now,
    }) ?? "unknown";
    const isPersistentAuthIssue = inferredReason === "auth" || inferredReason === "auth_permanent";
    if (isPersistentAuthIssue) {
        return {
            type: "skip",
            reason: inferredReason,
            error: `Provider ${params.candidate.provider} has ${inferredReason} issue (skipping all models)`,
        };
    }
    // Billing is semi-persistent: the user may fix their balance, or a transient
    // 402 might have been misclassified. Probe single-provider setups on the
    // standard throttle so they can recover without a restart; when fallbacks
    // exist, only probe near cooldown expiry so the fallback chain stays preferred.
    if (inferredReason === "billing") {
        const shouldProbeSingleProviderBilling = params.isPrimary &&
            !params.hasFallbackCandidates &&
            isProbeThrottleOpen(params.now, params.probeThrottleKey);
        if (params.isPrimary && (shouldProbe || shouldProbeSingleProviderBilling)) {
            return { type: "attempt", reason: inferredReason, markProbe: true };
        }
        return {
            type: "skip",
            reason: inferredReason,
            error: `Provider ${params.candidate.provider} has ${inferredReason} issue (skipping all models)`,
        };
    }
    // For primary: try when requested model or when probe allows.
    // For same-provider fallbacks: only relax cooldown on transient provider
    // limits, which are often model-scoped and can recover on a sibling model.
    const shouldAttemptDespiteCooldown = (params.isPrimary && (!params.requestedModel || shouldProbe)) ||
        (!params.isPrimary &&
            (inferredReason === "rate_limit" ||
                inferredReason === "overloaded" ||
                inferredReason === "unknown"));
    if (!shouldAttemptDespiteCooldown) {
        return {
            type: "skip",
            reason: inferredReason,
            error: `Provider ${params.candidate.provider} is in cooldown (all profiles unavailable)`,
        };
    }
    return {
        type: "attempt",
        reason: inferredReason,
        markProbe: params.isPrimary && shouldProbe,
    };
}
export async function runWithModelFallback(params) {
    const candidates = resolveFallbackCandidates({
        cfg: params.cfg,
        provider: params.provider,
        model: params.model,
        fallbacksOverride: params.fallbacksOverride,
    });
    const authStore = params.cfg
        ? ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false })
        : null;
    const attempts = [];
    let lastError;
    const cooldownProbeUsedProviders = new Set();
    const hasFallbackCandidates = candidates.length > 1;
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const isPrimary = i === 0;
        const requestedModel = params.provider === candidate.provider && params.model === candidate.model;
        let runOptions;
        let attemptedDuringCooldown = false;
        let transientProbeProviderForAttempt = null;
        if (authStore) {
            const profileIds = resolveAuthProfileOrder({
                cfg: params.cfg,
                store: authStore,
                provider: candidate.provider,
            });
            const isAnyProfileAvailable = profileIds.some((id) => !isProfileInCooldown(authStore, id, undefined, candidate.model));
            if (profileIds.length > 0 && !isAnyProfileAvailable) {
                // All profiles for this provider are in cooldown.
                const now = Date.now();
                const probeThrottleKey = resolveProbeThrottleKey(candidate.provider, params.agentDir);
                const decision = resolveCooldownDecision({
                    candidate,
                    isPrimary,
                    requestedModel,
                    hasFallbackCandidates,
                    now,
                    probeThrottleKey,
                    authStore,
                    profileIds,
                });
                if (decision.type === "skip") {
                    attempts.push({
                        provider: candidate.provider,
                        model: candidate.model,
                        error: decision.error,
                        reason: decision.reason,
                    });
                    logModelFallbackDecision({
                        decision: "skip_candidate",
                        runId: params.runId,
                        requestedProvider: params.provider,
                        requestedModel: params.model,
                        candidate,
                        attempt: i + 1,
                        total: candidates.length,
                        reason: decision.reason,
                        error: decision.error,
                        nextCandidate: candidates[i + 1],
                        isPrimary,
                        requestedModelMatched: requestedModel,
                        fallbackConfigured: hasFallbackCandidates,
                        profileCount: profileIds.length,
                    });
                    continue;
                }
                if (decision.markProbe) {
                    markProbeAttempt(now, probeThrottleKey);
                }
                if (shouldAllowCooldownProbeForReason(decision.reason)) {
                    // Probe at most once per provider per fallback run when all profiles
                    // are cooldowned. Re-probing every same-provider candidate can stall
                    // cross-provider fallback on providers with long internal retries.
                    const isTransientCooldownReason = shouldUseTransientCooldownProbeSlot(decision.reason);
                    if (isTransientCooldownReason && cooldownProbeUsedProviders.has(candidate.provider)) {
                        const error = `Provider ${candidate.provider} is in cooldown (probe already attempted this run)`;
                        attempts.push({
                            provider: candidate.provider,
                            model: candidate.model,
                            error,
                            reason: decision.reason,
                        });
                        logModelFallbackDecision({
                            decision: "skip_candidate",
                            runId: params.runId,
                            requestedProvider: params.provider,
                            requestedModel: params.model,
                            candidate,
                            attempt: i + 1,
                            total: candidates.length,
                            reason: decision.reason,
                            error,
                            nextCandidate: candidates[i + 1],
                            isPrimary,
                            requestedModelMatched: requestedModel,
                            fallbackConfigured: hasFallbackCandidates,
                            profileCount: profileIds.length,
                        });
                        continue;
                    }
                    runOptions = { allowTransientCooldownProbe: true };
                    if (isTransientCooldownReason) {
                        transientProbeProviderForAttempt = candidate.provider;
                    }
                }
                attemptedDuringCooldown = true;
                logModelFallbackDecision({
                    decision: "probe_cooldown_candidate",
                    runId: params.runId,
                    requestedProvider: params.provider,
                    requestedModel: params.model,
                    candidate,
                    attempt: i + 1,
                    total: candidates.length,
                    reason: decision.reason,
                    nextCandidate: candidates[i + 1],
                    isPrimary,
                    requestedModelMatched: requestedModel,
                    fallbackConfigured: hasFallbackCandidates,
                    allowTransientCooldownProbe: runOptions?.allowTransientCooldownProbe,
                    profileCount: profileIds.length,
                });
            }
        }
        const attemptRun = await runFallbackAttempt({
            run: params.run,
            ...candidate,
            attempts,
            options: runOptions,
        });
        if ("success" in attemptRun) {
            if (i > 0 || attempts.length > 0 || attemptedDuringCooldown) {
                logModelFallbackDecision({
                    decision: "candidate_succeeded",
                    runId: params.runId,
                    requestedProvider: params.provider,
                    requestedModel: params.model,
                    candidate,
                    attempt: i + 1,
                    total: candidates.length,
                    previousAttempts: attempts,
                    isPrimary,
                    requestedModelMatched: requestedModel,
                    fallbackConfigured: hasFallbackCandidates,
                });
            }
            const notFoundAttempt = i > 0 ? attempts.find((a) => a.reason === "model_not_found") : undefined;
            if (notFoundAttempt) {
                log.warn(`Model "${sanitizeForLog(notFoundAttempt.provider)}/${sanitizeForLog(notFoundAttempt.model)}" not found. Fell back to "${sanitizeForLog(candidate.provider)}/${sanitizeForLog(candidate.model)}".`);
            }
            return attemptRun.success;
        }
        const err = attemptRun.error;
        {
            if (transientProbeProviderForAttempt) {
                const probeFailureReason = describeFailoverError(err).reason;
                if (!shouldPreserveTransientCooldownProbeSlot(probeFailureReason)) {
                    cooldownProbeUsedProviders.add(transientProbeProviderForAttempt);
                }
            }
            // Context overflow errors should be handled by the inner runner's
            // compaction/retry logic, not by model fallback.  If one escapes as a
            // throw, rethrow it immediately rather than trying a different model
            // that may have a smaller context window and fail worse.
            const errMessage = err instanceof Error ? err.message : String(err);
            if (isLikelyContextOverflowError(errMessage)) {
                throw err;
            }
            const normalized = coerceToFailoverError(err, {
                provider: candidate.provider,
                model: candidate.model,
            }) ?? err;
            // Even unrecognized errors should not abort the fallback loop when
            // there are remaining candidates.  Only abort/context-overflow errors
            // (handled above) are truly non-retryable.
            const isKnownFailover = isFailoverError(normalized);
            if (!isKnownFailover && i === candidates.length - 1) {
                throw err;
            }
            lastError = isKnownFailover ? normalized : err;
            const described = describeFailoverError(normalized);
            attempts.push({
                provider: candidate.provider,
                model: candidate.model,
                error: described.message,
                reason: described.reason ?? "unknown",
                status: described.status,
                code: described.code,
            });
            logModelFallbackDecision({
                decision: "candidate_failed",
                runId: params.runId,
                requestedProvider: params.provider,
                requestedModel: params.model,
                candidate,
                attempt: i + 1,
                total: candidates.length,
                reason: described.reason,
                status: described.status,
                code: described.code,
                error: described.message,
                nextCandidate: candidates[i + 1],
                isPrimary,
                requestedModelMatched: requestedModel,
                fallbackConfigured: hasFallbackCandidates,
            });
            await params.onError?.({
                provider: candidate.provider,
                model: candidate.model,
                error: isKnownFailover ? normalized : err,
                attempt: i + 1,
                total: candidates.length,
            });
        }
    }
    throwFallbackFailureSummary({
        attempts,
        candidates,
        lastError,
        label: "models",
        formatAttempt: (attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}${attempt.reason ? ` (${attempt.reason})` : ""}`,
        soonestCooldownExpiry: resolveFallbackSoonestCooldownExpiry({
            authStore,
            agentDir: params.agentDir,
            cfg: params.cfg,
            candidates,
        }),
    });
}
export async function runWithImageModelFallback(params) {
    const candidates = resolveImageFallbackCandidates({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        modelOverride: params.modelOverride,
    });
    if (candidates.length === 0) {
        throw new Error("No image model configured. Set agents.defaults.imageModel.primary or agents.defaults.imageModel.fallbacks.");
    }
    const attempts = [];
    let lastError;
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const attemptRun = await runFallbackAttempt({ run: params.run, ...candidate, attempts });
        if ("success" in attemptRun) {
            return attemptRun.success;
        }
        {
            const err = attemptRun.error;
            lastError = err;
            attempts.push({
                provider: candidate.provider,
                model: candidate.model,
                error: err instanceof Error ? err.message : String(err),
            });
            await params.onError?.({
                provider: candidate.provider,
                model: candidate.model,
                error: err,
                attempt: i + 1,
                total: candidates.length,
            });
        }
    }
    throwFallbackFailureSummary({
        attempts,
        candidates,
        lastError,
        label: "image models",
        formatAttempt: (attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`,
    });
}
