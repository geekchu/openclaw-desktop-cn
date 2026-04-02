export async function runAttemptContextEngineBootstrap(params) {
    if (!params.hadSessionFile ||
        !(params.contextEngine?.bootstrap || params.contextEngine?.maintain)) {
        return;
    }
    try {
        if (typeof params.contextEngine?.bootstrap === "function") {
            await params.contextEngine.bootstrap({
                sessionId: params.sessionId,
                sessionKey: params.sessionKey,
                sessionFile: params.sessionFile,
            });
        }
        await params.runMaintenance({
            contextEngine: params.contextEngine,
            sessionId: params.sessionId,
            sessionKey: params.sessionKey,
            sessionFile: params.sessionFile,
            reason: "bootstrap",
            sessionManager: params.sessionManager,
            runtimeContext: params.runtimeContext,
        });
    }
    catch (bootstrapErr) {
        params.warn(`context engine bootstrap failed: ${String(bootstrapErr)}`);
    }
}
export async function assembleAttemptContextEngine(params) {
    if (!params.contextEngine) {
        return undefined;
    }
    return await params.contextEngine.assemble({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        messages: params.messages,
        tokenBudget: params.tokenBudget,
        model: params.modelId,
        ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
    });
}
export async function finalizeAttemptContextEngineTurn(params) {
    if (!params.contextEngine) {
        return { postTurnFinalizationSucceeded: true };
    }
    let postTurnFinalizationSucceeded = true;
    if (typeof params.contextEngine.afterTurn === "function") {
        try {
            await params.contextEngine.afterTurn({
                sessionId: params.sessionIdUsed,
                sessionKey: params.sessionKey,
                sessionFile: params.sessionFile,
                messages: params.messagesSnapshot,
                prePromptMessageCount: params.prePromptMessageCount,
                tokenBudget: params.tokenBudget,
                runtimeContext: params.runtimeContext,
            });
        }
        catch (afterTurnErr) {
            postTurnFinalizationSucceeded = false;
            params.warn(`context engine afterTurn failed: ${String(afterTurnErr)}`);
        }
    }
    else {
        const newMessages = params.messagesSnapshot.slice(params.prePromptMessageCount);
        if (newMessages.length > 0) {
            if (typeof params.contextEngine.ingestBatch === "function") {
                try {
                    await params.contextEngine.ingestBatch({
                        sessionId: params.sessionIdUsed,
                        sessionKey: params.sessionKey,
                        messages: newMessages,
                    });
                }
                catch (ingestErr) {
                    postTurnFinalizationSucceeded = false;
                    params.warn(`context engine ingest failed: ${String(ingestErr)}`);
                }
            }
            else {
                for (const msg of newMessages) {
                    try {
                        await params.contextEngine.ingest?.({
                            sessionId: params.sessionIdUsed,
                            sessionKey: params.sessionKey,
                            message: msg,
                        });
                    }
                    catch (ingestErr) {
                        postTurnFinalizationSucceeded = false;
                        params.warn(`context engine ingest failed: ${String(ingestErr)}`);
                    }
                }
            }
        }
    }
    if (!params.promptError &&
        !params.aborted &&
        !params.yieldAborted &&
        postTurnFinalizationSucceeded) {
        await params.runMaintenance({
            contextEngine: params.contextEngine,
            sessionId: params.sessionIdUsed,
            sessionKey: params.sessionKey,
            sessionFile: params.sessionFile,
            reason: "turn",
            sessionManager: params.sessionManager,
            runtimeContext: params.runtimeContext,
        });
    }
    return { postTurnFinalizationSucceeded };
}
