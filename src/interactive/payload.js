function readTrimmedString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
}
function normalizeButtonStyle(value) {
    const style = readTrimmedString(value)?.toLowerCase();
    return style === "primary" || style === "secondary" || style === "success" || style === "danger"
        ? style
        : undefined;
}
function normalizeInteractiveButton(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const record = raw;
    const label = readTrimmedString(record.label) ?? readTrimmedString(record.text);
    const value = readTrimmedString(record.value) ??
        readTrimmedString(record.callbackData) ??
        readTrimmedString(record.callback_data);
    if (!label || !value) {
        return undefined;
    }
    return {
        label,
        value,
        style: normalizeButtonStyle(record.style),
    };
}
function normalizeInteractiveOption(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const record = raw;
    const label = readTrimmedString(record.label) ?? readTrimmedString(record.text);
    const value = readTrimmedString(record.value);
    if (!label || !value) {
        return undefined;
    }
    return { label, value };
}
function normalizeInteractiveBlock(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const record = raw;
    const type = readTrimmedString(record.type)?.toLowerCase();
    if (type === "text") {
        const text = readTrimmedString(record.text);
        return text ? { type: "text", text } : undefined;
    }
    if (type === "buttons") {
        const buttons = Array.isArray(record.buttons)
            ? record.buttons
                .map((entry) => normalizeInteractiveButton(entry))
                .filter((entry) => Boolean(entry))
            : [];
        return buttons.length > 0 ? { type: "buttons", buttons } : undefined;
    }
    if (type === "select") {
        const options = Array.isArray(record.options)
            ? record.options
                .map((entry) => normalizeInteractiveOption(entry))
                .filter((entry) => Boolean(entry))
            : [];
        return options.length > 0
            ? {
                type: "select",
                placeholder: readTrimmedString(record.placeholder),
                options,
            }
            : undefined;
    }
    return undefined;
}
export function normalizeInteractiveReply(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const record = raw;
    const blocks = Array.isArray(record.blocks)
        ? record.blocks
            .map((entry) => normalizeInteractiveBlock(entry))
            .filter((entry) => Boolean(entry))
        : [];
    return blocks.length > 0 ? { blocks } : undefined;
}
export function hasInteractiveReplyBlocks(value) {
    return Boolean(normalizeInteractiveReply(value));
}
export function hasReplyChannelData(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}
export function hasReplyContent(params) {
    return Boolean(params.text?.trim() ||
        params.mediaUrl?.trim() ||
        params.mediaUrls?.some((entry) => Boolean(entry?.trim())) ||
        hasInteractiveReplyBlocks(params.interactive) ||
        params.hasChannelData ||
        params.extraContent);
}
export function hasReplyPayloadContent(payload, options) {
    return hasReplyContent({
        text: options?.trimText ? payload.text?.trim() : payload.text,
        mediaUrl: payload.mediaUrl,
        mediaUrls: payload.mediaUrls,
        interactive: payload.interactive,
        hasChannelData: options?.hasChannelData ?? hasReplyChannelData(payload.channelData),
        extraContent: options?.extraContent,
    });
}
export function resolveInteractiveTextFallback(params) {
    const text = readTrimmedString(params.text);
    if (text) {
        return params.text;
    }
    const interactiveText = (params.interactive?.blocks ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join("\n\n");
    return interactiveText || params.text;
}
