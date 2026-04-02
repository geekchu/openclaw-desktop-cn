import { readCodexCliCredentialsCached, readMiniMaxCliCredentialsCached, } from "../cli-credentials.js";
import { EXTERNAL_CLI_SYNC_TTL_MS, OPENAI_CODEX_DEFAULT_PROFILE_ID, MINIMAX_CLI_PROFILE_ID, log, } from "./constants.js";
function areOAuthCredentialsEquivalent(a, b) {
    if (!a) {
        return false;
    }
    if (a.type !== "oauth") {
        return false;
    }
    return (a.provider === b.provider &&
        a.access === b.access &&
        a.refresh === b.refresh &&
        a.expires === b.expires &&
        a.email === b.email &&
        a.enterpriseUrl === b.enterpriseUrl &&
        a.projectId === b.projectId &&
        a.accountId === b.accountId);
}
function hasNewerStoredOAuthCredential(existing, incoming) {
    return Boolean(existing &&
        existing.provider === incoming.provider &&
        Number.isFinite(existing.expires) &&
        (!Number.isFinite(incoming.expires) || existing.expires > incoming.expires));
}
export function shouldReplaceStoredOAuthCredential(existing, incoming) {
    if (!existing || existing.type !== "oauth") {
        return true;
    }
    if (areOAuthCredentialsEquivalent(existing, incoming)) {
        return false;
    }
    return !hasNewerStoredOAuthCredential(existing, incoming);
}
const EXTERNAL_CLI_SYNC_PROVIDERS = [
    {
        profileId: MINIMAX_CLI_PROFILE_ID,
        provider: "minimax-portal",
        readCredentials: () => readMiniMaxCliCredentialsCached({ ttlMs: EXTERNAL_CLI_SYNC_TTL_MS }),
    },
    {
        profileId: OPENAI_CODEX_DEFAULT_PROFILE_ID,
        provider: "openai-codex",
        readCredentials: () => readCodexCliCredentialsCached({ ttlMs: EXTERNAL_CLI_SYNC_TTL_MS }),
    },
];
/** Sync external CLI credentials into the store for a given provider. */
function syncExternalCliCredentialsForProvider(store, providerConfig, options) {
    const { profileId, provider, readCredentials } = providerConfig;
    const existing = store.profiles[profileId];
    const creds = readCredentials();
    if (!creds) {
        return false;
    }
    const existingOAuth = existing?.type === "oauth" ? existing : undefined;
    if (!shouldReplaceStoredOAuthCredential(existingOAuth, creds)) {
        if (options.log !== false) {
            if (!areOAuthCredentialsEquivalent(existingOAuth, creds) && existingOAuth) {
                log.debug(`kept newer stored ${provider} credentials over external cli sync`, {
                    profileId,
                    storedExpires: new Date(existingOAuth.expires).toISOString(),
                    externalExpires: Number.isFinite(creds.expires)
                        ? new Date(creds.expires).toISOString()
                        : null,
                });
            }
        }
        return false;
    }
    store.profiles[profileId] = creds;
    if (options.log !== false) {
        log.info(`synced ${provider} credentials from external cli`, {
            profileId,
            expires: new Date(creds.expires).toISOString(),
        });
    }
    return true;
}
/**
 * Sync OAuth credentials from external CLI tools (MiniMax CLI, Codex CLI)
 * into the store.
 *
 * Returns true if any credentials were updated.
 */
export function syncExternalCliCredentials(store, options = {}) {
    let mutated = false;
    for (const provider of EXTERNAL_CLI_SYNC_PROVIDERS) {
        if (syncExternalCliCredentialsForProvider(store, provider, options)) {
            mutated = true;
        }
    }
    return mutated;
}
