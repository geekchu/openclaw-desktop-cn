import { listAgentEntries } from "../../agents/agent-scope.js";
import { resolveFastModeState } from "../../agents/fast-mode.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox/runtime-status.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { shouldHandleTextCommands } from "../commands-text-routing.js";
import { resolveBlockStreamingChunking } from "./block-streaming.js";
import { buildCommandContext } from "./commands-context.js";
import { parseInlineDirectives } from "./directive-handling.parse.js";
import { applyInlineDirectiveOverrides } from "./get-reply-directives-apply.js";
import { clearExecInlineDirectives, clearInlineDirectives } from "./get-reply-directives-utils.js";
import { defaultGroupActivation, resolveGroupRequireMention } from "./groups.js";
import { CURRENT_MESSAGE_MARKER, stripMentions, stripStructuralPrefixes } from "./mentions.js";
import { createModelSelectionState, resolveContextTokens } from "./model-selection.js";
import { formatElevatedUnavailableMessage, resolveElevatedPermissions } from "./reply-elevated.js";
import { stripInlineStatus } from "./reply-inline.js";
let commandsRegistryPromise = null;
let skillCommandsPromise = null;
function loadCommandsRegistry() {
    commandsRegistryPromise ??= import("../commands-registry.runtime.js");
    return commandsRegistryPromise;
}
function loadSkillCommands() {
    skillCommandsPromise ??= import("../skill-commands.runtime.js");
    return skillCommandsPromise;
}
function resolveExecOverrides(params) {
    const host = params.directives.execHost ?? params.sessionEntry?.execHost;
    const security = params.directives.execSecurity ??
        params.sessionEntry?.execSecurity;
    const ask = params.directives.execAsk ?? params.sessionEntry?.execAsk;
    const node = params.directives.execNode ?? params.sessionEntry?.execNode;
    if (!host && !security && !ask && !node) {
        return undefined;
    }
    return { host, security, ask, node };
}
export async function resolveReplyDirectives(params) {
    const { ctx, cfg, agentId, agentCfg, agentDir, workspaceDir, sessionCtx, sessionEntry, sessionStore, sessionKey, storePath, sessionScope, groupResolution, isGroup, triggerBodyNormalized, commandAuthorized, defaultProvider, defaultModel, provider: initialProvider, model: initialModel, hasResolvedHeartbeatModelOverride, typing, opts, skillFilter, } = params;
    const agentEntry = listAgentEntries(cfg).find((entry) => normalizeAgentId(entry.id) === normalizeAgentId(agentId));
    let provider = initialProvider;
    let model = initialModel;
    // Prefer CommandBody/RawBody (clean message without structural context) for directive parsing.
    // Keep `Body`/`BodyStripped` as the best-available prompt text (may include context).
    const commandSource = sessionCtx.BodyForCommands ??
        sessionCtx.CommandBody ??
        sessionCtx.RawBody ??
        sessionCtx.Transcript ??
        sessionCtx.BodyStripped ??
        sessionCtx.Body ??
        ctx.BodyForCommands ??
        ctx.CommandBody ??
        ctx.RawBody ??
        "";
    const promptSource = sessionCtx.BodyForAgent ?? sessionCtx.BodyStripped ?? sessionCtx.Body ?? "";
    const commandText = commandSource || promptSource;
    const command = buildCommandContext({
        ctx,
        cfg,
        agentId,
        sessionKey,
        isGroup,
        triggerBodyNormalized,
        commandAuthorized,
    });
    const allowTextCommands = shouldHandleTextCommands({
        cfg,
        surface: command.surface,
        commandSource: ctx.CommandSource,
    });
    const commandTextHasSlash = commandText.includes("/");
    const reservedCommands = new Set();
    if (commandTextHasSlash) {
        const { listChatCommands } = await loadCommandsRegistry();
        for (const chatCommand of listChatCommands()) {
            for (const alias of chatCommand.textAliases) {
                reservedCommands.add(alias.replace(/^\//, "").toLowerCase());
            }
        }
    }
    const rawAliases = commandTextHasSlash
        ? Object.values(cfg.agents?.defaults?.models ?? {})
            .map((entry) => entry.alias?.trim())
            .filter((alias) => Boolean(alias))
            .filter((alias) => !reservedCommands.has(alias.toLowerCase()))
        : [];
    // Only load workspace skill commands when we actually need them to filter aliases.
    // This avoids scanning skills for messages that only use plain text with no slash syntax.
    const skillCommands = allowTextCommands && commandTextHasSlash && rawAliases.length > 0
        ? (await loadSkillCommands()).listSkillCommandsForWorkspace({
            workspaceDir,
            cfg,
            skillFilter,
        })
        : [];
    for (const command of skillCommands) {
        reservedCommands.add(command.name.toLowerCase());
    }
    const configuredAliases = rawAliases.filter((alias) => !reservedCommands.has(alias.toLowerCase()));
    const allowStatusDirective = allowTextCommands && command.isAuthorizedSender;
    let parsedDirectives = parseInlineDirectives(commandText, {
        modelAliases: configuredAliases,
        allowStatusDirective,
    });
    const hasInlineStatus = parsedDirectives.hasStatusDirective && parsedDirectives.cleaned.trim().length > 0;
    if (hasInlineStatus) {
        parsedDirectives = {
            ...parsedDirectives,
            hasStatusDirective: false,
        };
    }
    if (isGroup && ctx.WasMentioned !== true && parsedDirectives.hasElevatedDirective) {
        if (parsedDirectives.elevatedLevel !== "off") {
            parsedDirectives = {
                ...parsedDirectives,
                hasElevatedDirective: false,
                elevatedLevel: undefined,
                rawElevatedLevel: undefined,
            };
        }
    }
    if (isGroup && ctx.WasMentioned !== true && parsedDirectives.hasExecDirective) {
        if (parsedDirectives.execSecurity !== "deny") {
            parsedDirectives = clearExecInlineDirectives(parsedDirectives);
        }
    }
    const hasInlineDirective = parsedDirectives.hasThinkDirective ||
        parsedDirectives.hasVerboseDirective ||
        parsedDirectives.hasFastDirective ||
        parsedDirectives.hasReasoningDirective ||
        parsedDirectives.hasElevatedDirective ||
        parsedDirectives.hasExecDirective ||
        parsedDirectives.hasModelDirective ||
        parsedDirectives.hasQueueDirective;
    if (hasInlineDirective) {
        const stripped = stripStructuralPrefixes(parsedDirectives.cleaned);
        const noMentions = isGroup ? stripMentions(stripped, ctx, cfg, agentId) : stripped;
        if (noMentions.trim().length > 0) {
            const directiveOnlyCheck = parseInlineDirectives(noMentions, {
                modelAliases: configuredAliases,
            });
            if (directiveOnlyCheck.cleaned.trim().length > 0) {
                const allowInlineStatus = parsedDirectives.hasStatusDirective && allowTextCommands && command.isAuthorizedSender;
                parsedDirectives = allowInlineStatus
                    ? {
                        ...clearInlineDirectives(parsedDirectives.cleaned),
                        hasStatusDirective: true,
                    }
                    : clearInlineDirectives(parsedDirectives.cleaned);
            }
        }
    }
    // Use command.isAuthorizedSender (resolved authorization) instead of raw commandAuthorized
    // to ensure inline directives work when commands.allowFrom grants access (e.g., LINE).
    let directives = command.isAuthorizedSender
        ? parsedDirectives
        : {
            ...parsedDirectives,
            hasThinkDirective: false,
            hasVerboseDirective: false,
            hasFastDirective: false,
            hasReasoningDirective: false,
            hasStatusDirective: false,
            hasModelDirective: false,
            hasQueueDirective: false,
            queueReset: false,
        };
    const existingBody = sessionCtx.BodyStripped ?? sessionCtx.Body ?? "";
    let cleanedBody = (() => {
        if (!existingBody) {
            return parsedDirectives.cleaned;
        }
        if (!sessionCtx.CommandBody && !sessionCtx.RawBody) {
            return parseInlineDirectives(existingBody, {
                modelAliases: configuredAliases,
                allowStatusDirective,
            }).cleaned;
        }
        const markerIndex = existingBody.indexOf(CURRENT_MESSAGE_MARKER);
        if (markerIndex < 0) {
            return parseInlineDirectives(existingBody, {
                modelAliases: configuredAliases,
                allowStatusDirective,
            }).cleaned;
        }
        const head = existingBody.slice(0, markerIndex + CURRENT_MESSAGE_MARKER.length);
        const tail = existingBody.slice(markerIndex + CURRENT_MESSAGE_MARKER.length);
        const cleanedTail = parseInlineDirectives(tail, {
            modelAliases: configuredAliases,
            allowStatusDirective,
        }).cleaned;
        return `${head}${cleanedTail}`;
    })();
    if (allowStatusDirective) {
        cleanedBody = stripInlineStatus(cleanedBody).cleaned;
    }
    sessionCtx.BodyForAgent = cleanedBody;
    sessionCtx.Body = cleanedBody;
    sessionCtx.BodyStripped = cleanedBody;
    const messageProviderKey = sessionCtx.Provider?.trim().toLowerCase() ?? ctx.Provider?.trim().toLowerCase() ?? "";
    const elevated = resolveElevatedPermissions({
        cfg,
        agentId,
        ctx,
        provider: messageProviderKey,
    });
    const elevatedEnabled = elevated.enabled;
    const elevatedAllowed = elevated.allowed;
    const elevatedFailures = elevated.failures;
    if (directives.hasElevatedDirective && (!elevatedEnabled || !elevatedAllowed)) {
        typing.cleanup();
        const runtimeSandboxed = resolveSandboxRuntimeStatus({
            cfg,
            sessionKey: ctx.SessionKey,
        }).sandboxed;
        return {
            kind: "reply",
            reply: {
                text: formatElevatedUnavailableMessage({
                    runtimeSandboxed,
                    failures: elevatedFailures,
                    sessionKey: ctx.SessionKey,
                }),
            },
        };
    }
    const requireMention = await resolveGroupRequireMention({
        cfg,
        ctx: sessionCtx,
        groupResolution,
    });
    const defaultActivation = defaultGroupActivation(requireMention);
    const resolvedThinkLevel = directives.thinkLevel ?? sessionEntry?.thinkingLevel;
    const resolvedFastMode = directives.fastMode ??
        resolveFastModeState({
            cfg,
            provider,
            model,
            agentId,
            sessionEntry,
        }).enabled;
    const resolvedVerboseLevel = directives.verboseLevel ??
        sessionEntry?.verboseLevel ??
        agentCfg?.verboseDefault;
    let resolvedReasoningLevel = directives.reasoningLevel ??
        sessionEntry?.reasoningLevel ??
        agentEntry?.reasoningDefault ??
        "off";
    const resolvedElevatedLevel = elevatedAllowed
        ? (directives.elevatedLevel ??
            sessionEntry?.elevatedLevel ??
            agentCfg?.elevatedDefault ??
            "on")
        : "off";
    const resolvedBlockStreaming = opts?.disableBlockStreaming === true
        ? "off"
        : opts?.disableBlockStreaming === false
            ? "on"
            : agentCfg?.blockStreamingDefault === "on"
                ? "on"
                : "off";
    const resolvedBlockStreamingBreak = agentCfg?.blockStreamingBreak === "message_end" ? "message_end" : "text_end";
    const blockStreamingEnabled = resolvedBlockStreaming === "on" && opts?.disableBlockStreaming !== true;
    const blockReplyChunking = blockStreamingEnabled
        ? resolveBlockStreamingChunking(cfg, sessionCtx.Provider, sessionCtx.AccountId)
        : undefined;
    const modelState = await createModelSelectionState({
        cfg,
        agentId,
        agentCfg,
        sessionEntry,
        sessionStore,
        sessionKey,
        parentSessionKey: ctx.ParentSessionKey,
        storePath,
        defaultProvider,
        defaultModel,
        provider,
        model,
        hasModelDirective: directives.hasModelDirective,
        hasResolvedHeartbeatModelOverride,
    });
    provider = modelState.provider;
    model = modelState.model;
    const resolvedThinkLevelWithDefault = resolvedThinkLevel ??
        (await modelState.resolveDefaultThinkingLevel()) ??
        agentCfg?.thinkingDefault;
    // When neither directive nor session nor agent set reasoning, default to model capability
    // (e.g. OpenRouter with reasoning: true). Skip model default when thinking is active
    // to avoid redundant Reasoning: output alongside internal thinking blocks.
    const hasAgentReasoningDefault = agentEntry?.reasoningDefault !== undefined && agentEntry?.reasoningDefault !== null;
    const reasoningExplicitlySet = directives.reasoningLevel !== undefined ||
        (sessionEntry?.reasoningLevel !== undefined && sessionEntry?.reasoningLevel !== null) ||
        hasAgentReasoningDefault;
    const thinkingActive = resolvedThinkLevelWithDefault !== "off";
    if (!reasoningExplicitlySet && resolvedReasoningLevel === "off" && !thinkingActive) {
        resolvedReasoningLevel = await modelState.resolveDefaultReasoningLevel();
    }
    let contextTokens = resolveContextTokens({
        cfg,
        agentCfg,
        provider,
        model,
    });
    const initialModelLabel = `${provider}/${model}`;
    const formatModelSwitchEvent = (label, alias) => alias ? `Model switched to ${alias} (${label}).` : `Model switched to ${label}.`;
    const isModelListAlias = directives.hasModelDirective &&
        ["status", "list"].includes(directives.rawModelDirective?.trim().toLowerCase() ?? "");
    const effectiveModelDirective = isModelListAlias ? undefined : directives.rawModelDirective;
    const inlineStatusRequested = hasInlineStatus && allowTextCommands && command.isAuthorizedSender;
    const applyResult = await applyInlineDirectiveOverrides({
        ctx,
        cfg,
        agentId,
        agentDir,
        agentCfg,
        agentEntry,
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
        sessionScope,
        isGroup,
        allowTextCommands,
        command,
        directives,
        messageProviderKey,
        elevatedEnabled,
        elevatedAllowed,
        elevatedFailures,
        defaultProvider,
        defaultModel,
        aliasIndex: params.aliasIndex,
        provider,
        model,
        modelState,
        initialModelLabel,
        formatModelSwitchEvent,
        resolvedElevatedLevel,
        defaultActivation: () => defaultActivation,
        contextTokens,
        effectiveModelDirective,
        typing,
    });
    if (applyResult.kind === "reply") {
        return { kind: "reply", reply: applyResult.reply };
    }
    directives = applyResult.directives;
    provider = applyResult.provider;
    model = applyResult.model;
    contextTokens = applyResult.contextTokens;
    const { directiveAck, perMessageQueueMode, perMessageQueueOptions } = applyResult;
    const execOverrides = resolveExecOverrides({ directives, sessionEntry });
    return {
        kind: "continue",
        result: {
            commandSource: commandText,
            command,
            allowTextCommands,
            skillCommands,
            directives,
            cleanedBody,
            messageProviderKey,
            elevatedEnabled,
            elevatedAllowed,
            elevatedFailures,
            defaultActivation,
            resolvedThinkLevel: resolvedThinkLevelWithDefault,
            resolvedFastMode,
            resolvedVerboseLevel,
            resolvedReasoningLevel,
            resolvedElevatedLevel,
            execOverrides,
            blockStreamingEnabled,
            blockReplyChunking,
            resolvedBlockStreamingBreak,
            provider,
            model,
            modelState,
            contextTokens,
            inlineStatusRequested,
            directiveAck,
            perMessageQueueMode,
            perMessageQueueOptions,
        },
    };
}
