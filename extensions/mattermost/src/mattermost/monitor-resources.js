import { fetchMattermostChannel, fetchMattermostUser, sendMattermostTyping, updateMattermostPost, } from "./client.js";
import { buildButtonProps } from "./interactions.js";
const CHANNEL_CACHE_TTL_MS = 5 * 60_000;
const USER_CACHE_TTL_MS = 10 * 60_000;
export function createMattermostMonitorResources(params) {
    const { accountId, callbackUrl, client, logger, mediaMaxBytes, fetchRemoteMedia, saveMediaBuffer, mediaKindFromMime, } = params;
    const channelCache = new Map();
    const userCache = new Map();
    const resolveMattermostMedia = async (fileIds) => {
        const ids = (fileIds ?? []).map((id) => id?.trim()).filter(Boolean);
        if (ids.length === 0) {
            return [];
        }
        const out = [];
        for (const fileId of ids) {
            try {
                const fetched = await fetchRemoteMedia({
                    url: `${client.apiBaseUrl}/files/${fileId}`,
                    requestInit: {
                        headers: {
                            Authorization: `Bearer ${client.token}`,
                        },
                    },
                    filePathHint: fileId,
                    maxBytes: mediaMaxBytes,
                    ssrfPolicy: { allowedHostnames: [new URL(client.baseUrl).hostname] },
                });
                const saved = await saveMediaBuffer(Buffer.from(fetched.buffer), fetched.contentType ?? undefined, "inbound", mediaMaxBytes);
                const contentType = saved.contentType ?? fetched.contentType ?? undefined;
                out.push({
                    path: saved.path,
                    contentType,
                    kind: mediaKindFromMime(contentType) ?? "unknown",
                });
            }
            catch (err) {
                logger.debug?.(`mattermost: failed to download file ${fileId}: ${String(err)}`);
            }
        }
        return out;
    };
    const sendTypingIndicator = async (channelId, parentId) => {
        await sendMattermostTyping(client, { channelId, parentId });
    };
    const resolveChannelInfo = async (channelId) => {
        const cached = channelCache.get(channelId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        try {
            const info = await fetchMattermostChannel(client, channelId);
            channelCache.set(channelId, {
                value: info,
                expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
            });
            return info;
        }
        catch (err) {
            logger.debug?.(`mattermost: channel lookup failed: ${String(err)}`);
            channelCache.set(channelId, {
                value: null,
                expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
            });
            return null;
        }
    };
    const resolveUserInfo = async (userId) => {
        const cached = userCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        try {
            const info = await fetchMattermostUser(client, userId);
            userCache.set(userId, {
                value: info,
                expiresAt: Date.now() + USER_CACHE_TTL_MS,
            });
            return info;
        }
        catch (err) {
            logger.debug?.(`mattermost: user lookup failed: ${String(err)}`);
            userCache.set(userId, {
                value: null,
                expiresAt: Date.now() + USER_CACHE_TTL_MS,
            });
            return null;
        }
    };
    const buildModelPickerProps = (channelId, buttons) => buildButtonProps({
        callbackUrl,
        accountId,
        channelId,
        buttons,
    });
    const updateModelPickerPost = async (params) => {
        const props = buildModelPickerProps(params.channelId, params.buttons ?? []) ?? {
            attachments: [],
        };
        await updateMattermostPost(client, params.postId, {
            message: params.message,
            props,
        });
        return {};
    };
    return {
        resolveMattermostMedia,
        sendTypingIndicator,
        resolveChannelInfo,
        resolveUserInfo,
        updateModelPickerPost,
    };
}
