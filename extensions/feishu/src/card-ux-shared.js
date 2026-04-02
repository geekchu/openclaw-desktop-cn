export function buildFeishuCardButton(params) {
    return {
        tag: "button",
        text: {
            tag: "plain_text",
            content: params.label,
        },
        type: params.type ?? "default",
        value: params.value,
    };
}
export function buildFeishuCardInteractionContext(params) {
    return {
        u: params.operatorOpenId,
        ...(params.chatId ? { h: params.chatId } : {}),
        ...(params.sessionKey ? { s: params.sessionKey } : {}),
        e: params.expiresAt,
        ...(params.chatType ? { t: params.chatType } : {}),
    };
}
