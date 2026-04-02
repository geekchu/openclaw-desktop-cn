import { GENERATED_BUNDLED_PLUGIN_METADATA } from "../plugins/bundled-plugin-metadata.generated.js";
import { CHAT_CHANNEL_ORDER } from "./ids.js";
const CHAT_CHANNEL_ID_SET = new Set(CHAT_CHANNEL_ORDER);
function toChatChannelMeta(params) {
    const label = params.channel.label?.trim();
    if (!label) {
        throw new Error(`Missing label for bundled chat channel "${params.id}"`);
    }
    return {
        id: params.id,
        label,
        selectionLabel: params.channel.selectionLabel?.trim() || label,
        docsPath: params.channel.docsPath?.trim() || `/channels/${params.id}`,
        docsLabel: params.channel.docsLabel?.trim() || undefined,
        blurb: params.channel.blurb?.trim() || "",
        ...(params.channel.aliases?.length ? { aliases: params.channel.aliases } : {}),
        ...(params.channel.order !== undefined ? { order: params.channel.order } : {}),
        ...(params.channel.selectionDocsPrefix !== undefined
            ? { selectionDocsPrefix: params.channel.selectionDocsPrefix }
            : {}),
        ...(params.channel.selectionDocsOmitLabel !== undefined
            ? { selectionDocsOmitLabel: params.channel.selectionDocsOmitLabel }
            : {}),
        ...(params.channel.selectionExtras?.length
            ? { selectionExtras: params.channel.selectionExtras }
            : {}),
        ...(params.channel.detailLabel?.trim()
            ? { detailLabel: params.channel.detailLabel.trim() }
            : {}),
        ...(params.channel.systemImage?.trim()
            ? { systemImage: params.channel.systemImage.trim() }
            : {}),
        ...(params.channel.markdownCapable !== undefined
            ? { markdownCapable: params.channel.markdownCapable }
            : {}),
        ...(params.channel.showConfigured !== undefined
            ? { showConfigured: params.channel.showConfigured }
            : {}),
        ...(params.channel.quickstartAllowFrom !== undefined
            ? { quickstartAllowFrom: params.channel.quickstartAllowFrom }
            : {}),
        ...(params.channel.forceAccountBinding !== undefined
            ? { forceAccountBinding: params.channel.forceAccountBinding }
            : {}),
        ...(params.channel.preferSessionLookupForAnnounceTarget !== undefined
            ? {
                preferSessionLookupForAnnounceTarget: params.channel.preferSessionLookupForAnnounceTarget,
            }
            : {}),
        ...(params.channel.preferOver?.length ? { preferOver: params.channel.preferOver } : {}),
    };
}
function buildChatChannelMetaById() {
    const entries = new Map();
    for (const entry of GENERATED_BUNDLED_PLUGIN_METADATA) {
        const channel = entry.packageManifest && "channel" in entry.packageManifest
            ? entry.packageManifest.channel
            : undefined;
        if (!channel) {
            continue;
        }
        const rawId = channel?.id?.trim();
        if (!rawId || !CHAT_CHANNEL_ID_SET.has(rawId)) {
            continue;
        }
        const id = rawId;
        entries.set(id, toChatChannelMeta({
            id,
            channel,
        }));
    }
    const missingIds = CHAT_CHANNEL_ORDER.filter((id) => !entries.has(id));
    if (missingIds.length > 0) {
        throw new Error(`Missing bundled chat channel metadata for: ${missingIds.join(", ")}`);
    }
    return Object.freeze(Object.fromEntries(entries));
}
const CHAT_CHANNEL_META = buildChatChannelMetaById();
export const CHAT_CHANNEL_ALIASES = Object.freeze(Object.fromEntries(Object.values(CHAT_CHANNEL_META)
    .flatMap((meta) => (meta.aliases ?? []).map((alias) => [alias.trim().toLowerCase(), meta.id]))
    .filter(([alias]) => alias.length > 0)
    .toSorted(([left], [right]) => left.localeCompare(right))));
function normalizeChannelKey(raw) {
    const normalized = raw?.trim().toLowerCase();
    return normalized || undefined;
}
export function listChatChannels() {
    return CHAT_CHANNEL_ORDER.map((id) => CHAT_CHANNEL_META[id]);
}
export function listChatChannelAliases() {
    return Object.keys(CHAT_CHANNEL_ALIASES);
}
export function getChatChannelMeta(id) {
    return CHAT_CHANNEL_META[id];
}
export function normalizeChatChannelId(raw) {
    const normalized = normalizeChannelKey(raw);
    if (!normalized) {
        return null;
    }
    const resolved = CHAT_CHANNEL_ALIASES[normalized] ?? normalized;
    return CHAT_CHANNEL_ORDER.includes(resolved) ? resolved : null;
}
