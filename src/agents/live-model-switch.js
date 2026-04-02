import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { resolveDefaultModelForAgent } from "./model-selection.js";
import { consumeEmbeddedRunModelSwitch, requestEmbeddedRunModelSwitch, } from "./pi-embedded-runner/runs.js";
import { abortEmbeddedPiRun } from "./pi-embedded.js";
export class LiveSessionModelSwitchError extends Error {
    provider;
    model;
    authProfileId;
    authProfileIdSource;
    constructor(selection) {
        super(`Live session model switch requested: ${selection.provider}/${selection.model}`);
        this.name = "LiveSessionModelSwitchError";
        this.provider = selection.provider;
        this.model = selection.model;
        this.authProfileId = selection.authProfileId;
        this.authProfileIdSource = selection.authProfileIdSource;
    }
}
export function resolveLiveSessionModelSelection(params) {
    const sessionKey = params.sessionKey?.trim();
    const cfg = params.cfg;
    if (!cfg || !sessionKey) {
        return null;
    }
    const agentId = params.agentId?.trim();
    const defaultModelRef = agentId
        ? resolveDefaultModelForAgent({
            cfg,
            agentId,
        })
        : { provider: params.defaultProvider, model: params.defaultModel };
    const storePath = resolveStorePath(cfg.session?.store, {
        agentId,
    });
    const entry = loadSessionStore(storePath, { skipCache: true })[sessionKey];
    const provider = entry?.providerOverride?.trim() || defaultModelRef.provider;
    const model = entry?.modelOverride?.trim() || defaultModelRef.model;
    const authProfileId = entry?.authProfileOverride?.trim() || undefined;
    return {
        provider,
        model,
        authProfileId,
        authProfileIdSource: authProfileId ? entry?.authProfileOverrideSource : undefined,
    };
}
export function requestLiveSessionModelSwitch(params) {
    const sessionId = params.sessionEntry?.sessionId?.trim();
    if (!sessionId) {
        return false;
    }
    const aborted = abortEmbeddedPiRun(sessionId);
    if (!aborted) {
        return false;
    }
    requestEmbeddedRunModelSwitch(sessionId, params.selection);
    return true;
}
export function consumeLiveSessionModelSwitch(sessionId) {
    return consumeEmbeddedRunModelSwitch(sessionId);
}
export function hasDifferentLiveSessionModelSelection(current, next) {
    if (!next) {
        return false;
    }
    return (current.provider !== next.provider ||
        current.model !== next.model ||
        (current.authProfileId?.trim() || undefined) !== next.authProfileId ||
        (current.authProfileId?.trim() ? current.authProfileIdSource : undefined) !==
            next.authProfileIdSource);
}
