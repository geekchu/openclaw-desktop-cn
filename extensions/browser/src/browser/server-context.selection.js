import { fetchOk, normalizeCdpHttpBaseForJsonEndpoints } from "./cdp.helpers.js";
import { appendCdpPath } from "./cdp.js";
import { closeChromeMcpTab, focusChromeMcpTab } from "./chrome-mcp.js";
import { BrowserTabNotFoundError, BrowserTargetAmbiguousError } from "./errors.js";
import { getBrowserProfileCapabilities } from "./profile-capabilities.js";
import { getPwAiModule } from "./pw-ai-module.js";
import { resolveTargetIdFromTabs } from "./target-id.js";
export function createProfileSelectionOps({ profile, getProfileState, ensureBrowserAvailable, listTabs, openTab, }) {
    const cdpHttpBase = normalizeCdpHttpBaseForJsonEndpoints(profile.cdpUrl);
    const capabilities = getBrowserProfileCapabilities(profile);
    const ensureTabAvailable = async (targetId) => {
        await ensureBrowserAvailable();
        const profileState = getProfileState();
        const tabs1 = await listTabs();
        if (tabs1.length === 0) {
            await openTab("about:blank");
        }
        const tabs = await listTabs();
        const candidates = capabilities.supportsPerTabWs ? tabs.filter((t) => Boolean(t.wsUrl)) : tabs;
        const resolveById = (raw) => {
            const resolved = resolveTargetIdFromTabs(raw, candidates);
            if (!resolved.ok) {
                if (resolved.reason === "ambiguous") {
                    return "AMBIGUOUS";
                }
                return null;
            }
            return candidates.find((t) => t.targetId === resolved.targetId) ?? null;
        };
        const pickDefault = () => {
            const last = profileState.lastTargetId?.trim() || "";
            const lastResolved = last ? resolveById(last) : null;
            if (lastResolved && lastResolved !== "AMBIGUOUS") {
                return lastResolved;
            }
            // Prefer a real page tab first (avoid service workers/background targets).
            const page = candidates.find((t) => (t.type ?? "page") === "page");
            return page ?? candidates.at(0) ?? null;
        };
        const chosen = targetId ? resolveById(targetId) : pickDefault();
        if (chosen === "AMBIGUOUS") {
            throw new BrowserTargetAmbiguousError();
        }
        if (!chosen) {
            throw new BrowserTabNotFoundError();
        }
        profileState.lastTargetId = chosen.targetId;
        return chosen;
    };
    const resolveTargetIdOrThrow = async (targetId) => {
        const tabs = await listTabs();
        const resolved = resolveTargetIdFromTabs(targetId, tabs);
        if (!resolved.ok) {
            if (resolved.reason === "ambiguous") {
                throw new BrowserTargetAmbiguousError();
            }
            throw new BrowserTabNotFoundError();
        }
        return resolved.targetId;
    };
    const focusTab = async (targetId) => {
        const resolvedTargetId = await resolveTargetIdOrThrow(targetId);
        if (capabilities.usesChromeMcp) {
            await focusChromeMcpTab(profile.name, resolvedTargetId, profile.userDataDir);
            const profileState = getProfileState();
            profileState.lastTargetId = resolvedTargetId;
            return;
        }
        if (capabilities.usesPersistentPlaywright) {
            const mod = await getPwAiModule({ mode: "strict" });
            const focusPageByTargetIdViaPlaywright = mod
                ?.focusPageByTargetIdViaPlaywright;
            if (typeof focusPageByTargetIdViaPlaywright === "function") {
                await focusPageByTargetIdViaPlaywright({
                    cdpUrl: profile.cdpUrl,
                    targetId: resolvedTargetId,
                });
                const profileState = getProfileState();
                profileState.lastTargetId = resolvedTargetId;
                return;
            }
        }
        await fetchOk(appendCdpPath(cdpHttpBase, `/json/activate/${resolvedTargetId}`));
        const profileState = getProfileState();
        profileState.lastTargetId = resolvedTargetId;
    };
    const closeTab = async (targetId) => {
        const resolvedTargetId = await resolveTargetIdOrThrow(targetId);
        if (capabilities.usesChromeMcp) {
            await closeChromeMcpTab(profile.name, resolvedTargetId, profile.userDataDir);
            return;
        }
        // For remote profiles, use Playwright's persistent connection to close tabs
        if (capabilities.usesPersistentPlaywright) {
            const mod = await getPwAiModule({ mode: "strict" });
            const closePageByTargetIdViaPlaywright = mod
                ?.closePageByTargetIdViaPlaywright;
            if (typeof closePageByTargetIdViaPlaywright === "function") {
                await closePageByTargetIdViaPlaywright({
                    cdpUrl: profile.cdpUrl,
                    targetId: resolvedTargetId,
                });
                return;
            }
        }
        await fetchOk(appendCdpPath(cdpHttpBase, `/json/close/${resolvedTargetId}`));
    };
    return {
        ensureTabAvailable,
        focusTab,
        closeTab,
    };
}
