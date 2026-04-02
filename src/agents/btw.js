import { streamSimple, } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { resolveSessionFilePath, resolveSessionFilePathOptions, } from "../config/sessions.js";
import { diagnosticLogger as diag } from "../logging/diagnostic.js";
import { resolveSessionAuthProfileOverride } from "./auth-profiles/session-override.js";
import { getApiKeyForModel, requireApiKey } from "./model-auth.js";
import { ensureOpenClawModelsJson } from "./models-config.js";
import { EmbeddedBlockChunker } from "./pi-embedded-block-chunker.js";
import { resolveModelWithRegistry } from "./pi-embedded-runner/model.js";
import { getActiveEmbeddedRunSnapshot } from "./pi-embedded-runner/runs.js";
import { mapThinkingLevel } from "./pi-embedded-runner/utils.js";
import { discoverAuthStorage, discoverModels } from "./pi-model-discovery.js";
import { stripToolResultDetails } from "./session-transcript-repair.js";
function collectTextContent(content) {
    return content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}
function collectThinkingContent(content) {
    return content
        .filter((part) => part.type === "thinking")
        .map((part) => part.thinking)
        .join("");
}
function buildBtwSystemPrompt() {
    return [
        "You are answering an ephemeral /btw side question about the current conversation.",
        "Use the conversation only as background context.",
        "Answer only the side question in the last user message.",
        "Do not continue, resume, or complete any unfinished task from the conversation.",
        "Do not emit tool calls, pseudo-tool calls, shell commands, file writes, patches, or code unless the side question explicitly asks for them.",
        "Do not say you will continue the main task after answering.",
        "If the question can be answered briefly, answer briefly.",
    ].join("\n");
}
function buildBtwQuestionPrompt(question, inFlightPrompt) {
    const lines = [
        "Answer this side question only.",
        "Ignore any unfinished task in the conversation while answering it.",
    ];
    const trimmedPrompt = inFlightPrompt?.trim();
    if (trimmedPrompt) {
        lines.push("", "Current in-flight main task request for background context only:", "<in_flight_main_task>", trimmedPrompt, "</in_flight_main_task>", "Do not continue or complete that task while answering the side question.");
    }
    lines.push("", "<btw_side_question>", question.trim(), "</btw_side_question>");
    return lines.join("\n");
}
function toSimpleContextMessages(messages) {
    const contextMessages = messages.filter((message) => {
        if (!message || typeof message !== "object") {
            return false;
        }
        const role = message.role;
        return role === "user" || role === "assistant";
    });
    return stripToolResultDetails(contextMessages);
}
function resolveSimpleThinkingLevel(level) {
    if (!level || level === "off") {
        return undefined;
    }
    return mapThinkingLevel(level);
}
function resolveSessionTranscriptPath(params) {
    try {
        const agentId = params.sessionKey?.split(":")[1];
        const pathOpts = resolveSessionFilePathOptions({
            agentId,
            storePath: params.storePath,
        });
        return resolveSessionFilePath(params.sessionId, params.sessionEntry, pathOpts);
    }
    catch (error) {
        diag.debug(`resolveSessionTranscriptPath failed: sessionId=${params.sessionId} err=${String(error)}`);
        return undefined;
    }
}
async function resolveRuntimeModel(params) {
    await ensureOpenClawModelsJson(params.cfg, params.agentDir);
    const authStorage = discoverAuthStorage(params.agentDir);
    const modelRegistry = discoverModels(authStorage, params.agentDir);
    const model = resolveModelWithRegistry({
        provider: params.provider,
        modelId: params.model,
        modelRegistry,
        cfg: params.cfg,
    });
    if (!model) {
        throw new Error(`Unknown model: ${params.provider}/${params.model}`);
    }
    const authProfileId = await resolveSessionAuthProfileOverride({
        cfg: params.cfg,
        provider: params.provider,
        agentDir: params.agentDir,
        sessionEntry: params.sessionEntry,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        isNewSession: params.isNewSession,
    });
    return {
        model,
        authProfileId,
        authProfileIdSource: params.sessionEntry?.authProfileOverrideSource,
    };
}
export async function runBtwSideQuestion(params) {
    const sessionId = params.sessionEntry.sessionId?.trim();
    if (!sessionId) {
        throw new Error("No active session context.");
    }
    const sessionFile = resolveSessionTranscriptPath({
        sessionId,
        sessionEntry: params.sessionEntry,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
    });
    if (!sessionFile) {
        throw new Error("No active session transcript.");
    }
    const sessionManager = SessionManager.open(sessionFile);
    const activeRunSnapshot = getActiveEmbeddedRunSnapshot(sessionId);
    let messages = [];
    let inFlightPrompt;
    if (Array.isArray(activeRunSnapshot?.messages) && activeRunSnapshot.messages.length > 0) {
        messages = toSimpleContextMessages(activeRunSnapshot.messages);
        inFlightPrompt = activeRunSnapshot.inFlightPrompt;
    }
    else if (activeRunSnapshot) {
        inFlightPrompt = activeRunSnapshot.inFlightPrompt;
        if (activeRunSnapshot.transcriptLeafId && sessionManager.branch) {
            try {
                sessionManager.branch(activeRunSnapshot.transcriptLeafId);
            }
            catch (error) {
                diag.debug(`btw snapshot leaf unavailable: sessionId=${sessionId} leaf=${activeRunSnapshot.transcriptLeafId} err=${String(error)}`);
                sessionManager.resetLeaf?.();
            }
        }
        else {
            sessionManager.resetLeaf?.();
        }
    }
    else {
        const leafEntry = sessionManager.getLeafEntry?.();
        if (leafEntry?.type === "message" && leafEntry.message?.role === "user") {
            if (leafEntry.parentId && sessionManager.branch) {
                sessionManager.branch(leafEntry.parentId);
            }
            else {
                sessionManager.resetLeaf?.();
            }
        }
    }
    if (messages.length === 0) {
        const sessionContext = sessionManager.buildSessionContext();
        messages = toSimpleContextMessages(Array.isArray(sessionContext.messages) ? sessionContext.messages : []);
    }
    if (messages.length === 0 && !inFlightPrompt?.trim()) {
        throw new Error("No active session context.");
    }
    const { model, authProfileId } = await resolveRuntimeModel({
        cfg: params.cfg,
        provider: params.provider,
        model: params.model,
        agentDir: params.agentDir,
        sessionEntry: params.sessionEntry,
        sessionStore: params.sessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        isNewSession: params.isNewSession,
    });
    const apiKeyInfo = await getApiKeyForModel({
        model,
        cfg: params.cfg,
        profileId: authProfileId,
        agentDir: params.agentDir,
    });
    const apiKey = requireApiKey(apiKeyInfo, model.provider);
    const chunker = params.opts?.onBlockReply && params.blockReplyChunking
        ? new EmbeddedBlockChunker(params.blockReplyChunking)
        : undefined;
    let emittedBlocks = 0;
    let blockEmitChain = Promise.resolve();
    let answerText = "";
    let reasoningText = "";
    let assistantStarted = false;
    let sawTextEvent = false;
    const emitBlockChunk = async (text) => {
        const trimmed = text.trim();
        if (!trimmed || !params.opts?.onBlockReply) {
            return;
        }
        emittedBlocks += 1;
        blockEmitChain = blockEmitChain.then(async () => {
            await params.opts?.onBlockReply?.({
                text,
                btw: { question: params.question },
            });
        });
        await blockEmitChain;
    };
    const stream = streamSimple(model, {
        systemPrompt: buildBtwSystemPrompt(),
        messages: [
            ...messages,
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: buildBtwQuestionPrompt(params.question, inFlightPrompt),
                    },
                ],
                timestamp: Date.now(),
            },
        ],
    }, {
        apiKey,
        reasoning: resolveSimpleThinkingLevel(params.resolvedThinkLevel),
        signal: params.opts?.abortSignal,
    });
    let finalEvent;
    for await (const event of stream) {
        finalEvent = event.type === "done" || event.type === "error" ? event : finalEvent;
        if (!assistantStarted && (event.type === "text_start" || event.type === "start")) {
            assistantStarted = true;
            await params.opts?.onAssistantMessageStart?.();
        }
        if (event.type === "text_delta") {
            sawTextEvent = true;
            answerText += event.delta;
            chunker?.append(event.delta);
            if (chunker && params.resolvedBlockStreamingBreak === "text_end") {
                chunker.drain({ force: false, emit: (chunk) => void emitBlockChunk(chunk) });
            }
            continue;
        }
        if (event.type === "text_end" && chunker && params.resolvedBlockStreamingBreak === "text_end") {
            chunker.drain({ force: true, emit: (chunk) => void emitBlockChunk(chunk) });
            continue;
        }
        if (event.type === "thinking_delta") {
            reasoningText += event.delta;
            if (params.resolvedReasoningLevel !== "off") {
                await params.opts?.onReasoningStream?.({ text: reasoningText, isReasoning: true });
            }
            continue;
        }
        if (event.type === "thinking_end" && params.resolvedReasoningLevel !== "off") {
            await params.opts?.onReasoningEnd?.();
        }
    }
    if (chunker && params.resolvedBlockStreamingBreak !== "text_end" && chunker.hasBuffered()) {
        chunker.drain({ force: true, emit: (chunk) => void emitBlockChunk(chunk) });
    }
    await blockEmitChain;
    if (finalEvent?.type === "error") {
        const message = collectTextContent(finalEvent.error.content);
        throw new Error(message || finalEvent.error.errorMessage || "BTW failed.");
    }
    const finalMessage = finalEvent?.type === "done" ? finalEvent.message : undefined;
    if (finalMessage) {
        if (!sawTextEvent) {
            answerText = collectTextContent(finalMessage.content);
        }
        if (!reasoningText) {
            reasoningText = collectThinkingContent(finalMessage.content);
        }
    }
    const answer = answerText.trim();
    if (!answer) {
        throw new Error("No BTW response generated.");
    }
    if (emittedBlocks > 0) {
        return undefined;
    }
    return { text: answer };
}
