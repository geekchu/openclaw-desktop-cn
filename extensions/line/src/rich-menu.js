import { readFile } from "node:fs/promises";
import { messagingApi } from "@line/bot-sdk";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { resolveLineAccount } from "./accounts.js";
import { datetimePickerAction, messageAction, postbackAction, uriAction } from "./actions.js";
import { resolveLineChannelAccessToken } from "./channel-access-token.js";
const USER_BATCH_SIZE = 500;
function getClient(opts = {}) {
    const account = resolveLineAccount({
        cfg: loadConfig(),
        accountId: opts.accountId,
    });
    const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
    return new messagingApi.MessagingApiClient({
        channelAccessToken: token,
    });
}
function getBlobClient(opts = {}) {
    const account = resolveLineAccount({
        cfg: loadConfig(),
        accountId: opts.accountId,
    });
    const token = resolveLineChannelAccessToken(opts.channelAccessToken, account);
    return new messagingApi.MessagingApiBlobClient({
        channelAccessToken: token,
    });
}
function chunkUserIds(userIds) {
    const batches = [];
    for (let i = 0; i < userIds.length; i += USER_BATCH_SIZE) {
        batches.push(userIds.slice(i, i + USER_BATCH_SIZE));
    }
    return batches;
}
export async function createRichMenu(menu, opts = {}) {
    const client = getClient(opts);
    const richMenuRequest = {
        size: menu.size,
        selected: menu.selected ?? false,
        name: menu.name.slice(0, 300),
        chatBarText: menu.chatBarText.slice(0, 14),
        areas: menu.areas,
    };
    const response = await client.createRichMenu(richMenuRequest);
    if (opts.verbose) {
        logVerbose(`line: created rich menu ${response.richMenuId}`);
    }
    return response.richMenuId;
}
export async function uploadRichMenuImage(richMenuId, imagePath, opts = {}) {
    const blobClient = getBlobClient(opts);
    const imageData = await readFile(imagePath);
    const contentType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    await blobClient.setRichMenuImage(richMenuId, new Blob([imageData], { type: contentType }));
    if (opts.verbose) {
        logVerbose(`line: uploaded image to rich menu ${richMenuId}`);
    }
}
export async function setDefaultRichMenu(richMenuId, opts = {}) {
    const client = getClient(opts);
    await client.setDefaultRichMenu(richMenuId);
    if (opts.verbose) {
        logVerbose(`line: set default rich menu to ${richMenuId}`);
    }
}
export async function cancelDefaultRichMenu(opts = {}) {
    const client = getClient(opts);
    await client.cancelDefaultRichMenu();
    if (opts.verbose) {
        logVerbose("line: cancelled default rich menu");
    }
}
export async function getDefaultRichMenuId(opts = {}) {
    const client = getClient(opts);
    try {
        const response = await client.getDefaultRichMenuId();
        return response.richMenuId ?? null;
    }
    catch {
        return null;
    }
}
export async function linkRichMenuToUser(userId, richMenuId, opts = {}) {
    const client = getClient(opts);
    await client.linkRichMenuIdToUser(userId, richMenuId);
    if (opts.verbose) {
        logVerbose(`line: linked rich menu ${richMenuId} to user ${userId}`);
    }
}
export async function linkRichMenuToUsers(userIds, richMenuId, opts = {}) {
    const client = getClient(opts);
    for (const batch of chunkUserIds(userIds)) {
        await client.linkRichMenuIdToUsers({
            richMenuId,
            userIds: batch,
        });
    }
    if (opts.verbose) {
        logVerbose(`line: linked rich menu ${richMenuId} to ${userIds.length} users`);
    }
}
export async function unlinkRichMenuFromUser(userId, opts = {}) {
    const client = getClient(opts);
    await client.unlinkRichMenuIdFromUser(userId);
    if (opts.verbose) {
        logVerbose(`line: unlinked rich menu from user ${userId}`);
    }
}
export async function unlinkRichMenuFromUsers(userIds, opts = {}) {
    const client = getClient(opts);
    for (const batch of chunkUserIds(userIds)) {
        await client.unlinkRichMenuIdFromUsers({
            userIds: batch,
        });
    }
    if (opts.verbose) {
        logVerbose(`line: unlinked rich menu from ${userIds.length} users`);
    }
}
export async function getRichMenuIdOfUser(userId, opts = {}) {
    const client = getClient(opts);
    try {
        const response = await client.getRichMenuIdOfUser(userId);
        return response.richMenuId ?? null;
    }
    catch {
        return null;
    }
}
export async function getRichMenuList(opts = {}) {
    const client = getClient(opts);
    const response = await client.getRichMenuList();
    return response.richmenus ?? [];
}
export async function getRichMenu(richMenuId, opts = {}) {
    const client = getClient(opts);
    try {
        return await client.getRichMenu(richMenuId);
    }
    catch {
        return null;
    }
}
export async function deleteRichMenu(richMenuId, opts = {}) {
    const client = getClient(opts);
    await client.deleteRichMenu(richMenuId);
    if (opts.verbose) {
        logVerbose(`line: deleted rich menu ${richMenuId}`);
    }
}
export async function createRichMenuAlias(richMenuId, aliasId, opts = {}) {
    const client = getClient(opts);
    await client.createRichMenuAlias({
        richMenuId,
        richMenuAliasId: aliasId,
    });
    if (opts.verbose) {
        logVerbose(`line: created alias ${aliasId} for rich menu ${richMenuId}`);
    }
}
export async function deleteRichMenuAlias(aliasId, opts = {}) {
    const client = getClient(opts);
    await client.deleteRichMenuAlias(aliasId);
    if (opts.verbose) {
        logVerbose(`line: deleted alias ${aliasId}`);
    }
}
export function createGridLayout(height, actions) {
    const colWidth = Math.floor(2500 / 3);
    const rowHeight = Math.floor(height / 2);
    return [
        { bounds: { x: 0, y: 0, width: colWidth, height: rowHeight }, action: actions[0] },
        { bounds: { x: colWidth, y: 0, width: colWidth, height: rowHeight }, action: actions[1] },
        { bounds: { x: colWidth * 2, y: 0, width: colWidth, height: rowHeight }, action: actions[2] },
        { bounds: { x: 0, y: rowHeight, width: colWidth, height: rowHeight }, action: actions[3] },
        {
            bounds: { x: colWidth, y: rowHeight, width: colWidth, height: rowHeight },
            action: actions[4],
        },
        {
            bounds: { x: colWidth * 2, y: rowHeight, width: colWidth, height: rowHeight },
            action: actions[5],
        },
    ];
}
export { datetimePickerAction, messageAction, postbackAction, uriAction };
export function createDefaultMenuConfig() {
    return {
        size: { width: 2500, height: 843 },
        selected: false,
        name: "Default Menu",
        chatBarText: "Menu",
        areas: createGridLayout(843, [
            messageAction("Help", "/help"),
            messageAction("Status", "/status"),
            messageAction("Settings", "/settings"),
            messageAction("About", "/about"),
            messageAction("Feedback", "/feedback"),
            messageAction("Contact", "/contact"),
        ]),
    };
}
