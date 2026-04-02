import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BrowserProfileUnavailableError, BrowserTabNotFoundError } from "./errors.js";
const DEFAULT_CHROME_MCP_COMMAND = "npx";
const DEFAULT_CHROME_MCP_ARGS = [
    "-y",
    "chrome-devtools-mcp@latest",
    "--autoConnect",
    // Direct chrome-devtools-mcp launches do not enable structuredContent by default.
    "--experimentalStructuredContent",
    "--experimental-page-id-routing",
];
const sessions = new Map();
const pendingSessions = new Map();
let sessionFactory = null;
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function asPages(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const out = [];
    for (const entry of value) {
        const record = asRecord(entry);
        if (!record || typeof record.id !== "number") {
            continue;
        }
        out.push({
            id: record.id,
            url: typeof record.url === "string" ? record.url : undefined,
            selected: record.selected === true,
        });
    }
    return out;
}
function parsePageId(targetId) {
    const parsed = Number.parseInt(targetId.trim(), 10);
    if (!Number.isFinite(parsed)) {
        throw new BrowserTabNotFoundError();
    }
    return parsed;
}
function toBrowserTabs(pages) {
    return pages.map((page) => ({
        targetId: String(page.id),
        title: "",
        url: page.url ?? "",
        type: "page",
    }));
}
function extractStructuredContent(result) {
    return asRecord(result.structuredContent) ?? {};
}
function extractTextContent(result) {
    const content = Array.isArray(result.content) ? result.content : [];
    return content
        .map((entry) => {
        const record = asRecord(entry);
        return record && typeof record.text === "string" ? record.text : "";
    })
        .filter(Boolean);
}
function extractTextPages(result) {
    const pages = [];
    for (const block of extractTextContent(result)) {
        for (const line of block.split(/\r?\n/)) {
            const match = line.match(/^\s*(\d+):\s+(.+?)(?:\s+\[(selected)\])?\s*$/i);
            if (!match) {
                continue;
            }
            pages.push({
                id: Number.parseInt(match[1] ?? "", 10),
                url: match[2]?.trim() || undefined,
                selected: Boolean(match[3]),
            });
        }
    }
    return pages;
}
function extractStructuredPages(result) {
    const structured = asPages(extractStructuredContent(result).pages);
    return structured.length > 0 ? structured : extractTextPages(result);
}
function extractSnapshot(result) {
    const structured = extractStructuredContent(result);
    const snapshot = asRecord(structured.snapshot);
    if (!snapshot) {
        throw new Error("Chrome MCP snapshot response was missing structured snapshot data.");
    }
    return snapshot;
}
function extractJsonBlock(text) {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
    const raw = match?.[1]?.trim() || text.trim();
    return raw ? JSON.parse(raw) : null;
}
function extractMessageText(result) {
    const message = extractStructuredContent(result).message;
    if (typeof message === "string" && message.trim()) {
        return message;
    }
    const blocks = extractTextContent(result);
    return blocks.find((block) => block.trim()) ?? "";
}
function extractToolErrorMessage(result, name) {
    const message = extractMessageText(result).trim();
    return message || `Chrome MCP tool "${name}" failed.`;
}
function extractJsonMessage(result) {
    const candidates = [extractMessageText(result), ...extractTextContent(result)].filter((text) => text.trim());
    let lastError;
    for (const candidate of candidates) {
        try {
            return extractJsonBlock(candidate);
        }
        catch (err) {
            lastError = err;
        }
    }
    if (lastError) {
        throw lastError;
    }
    return null;
}
function normalizeChromeMcpUserDataDir(userDataDir) {
    const trimmed = userDataDir?.trim();
    return trimmed ? trimmed : undefined;
}
function buildChromeMcpSessionCacheKey(profileName, userDataDir) {
    return JSON.stringify([profileName, normalizeChromeMcpUserDataDir(userDataDir) ?? ""]);
}
function cacheKeyMatchesProfileName(cacheKey, profileName) {
    try {
        const parsed = JSON.parse(cacheKey);
        return Array.isArray(parsed) && parsed[0] === profileName;
    }
    catch {
        return false;
    }
}
async function closeChromeMcpSessionsForProfile(profileName, keepKey) {
    let closed = false;
    for (const key of Array.from(pendingSessions.keys())) {
        if (key !== keepKey && cacheKeyMatchesProfileName(key, profileName)) {
            pendingSessions.delete(key);
            closed = true;
        }
    }
    for (const [key, session] of Array.from(sessions.entries())) {
        if (key !== keepKey && cacheKeyMatchesProfileName(key, profileName)) {
            sessions.delete(key);
            closed = true;
            await session.client.close().catch(() => { });
        }
    }
    return closed;
}
export function buildChromeMcpArgs(userDataDir) {
    const normalizedUserDataDir = normalizeChromeMcpUserDataDir(userDataDir);
    return normalizedUserDataDir
        ? [...DEFAULT_CHROME_MCP_ARGS, "--userDataDir", normalizedUserDataDir]
        : [...DEFAULT_CHROME_MCP_ARGS];
}
async function createRealSession(profileName, userDataDir) {
    const transport = new StdioClientTransport({
        command: DEFAULT_CHROME_MCP_COMMAND,
        args: buildChromeMcpArgs(userDataDir),
        stderr: "pipe",
    });
    const client = new Client({
        name: "openclaw-browser",
        version: "0.0.0",
    }, {});
    const ready = (async () => {
        try {
            await client.connect(transport);
            const tools = await client.listTools();
            if (!tools.tools.some((tool) => tool.name === "list_pages")) {
                throw new Error("Chrome MCP server did not expose the expected navigation tools.");
            }
        }
        catch (err) {
            await client.close().catch(() => { });
            const targetLabel = userDataDir
                ? `the configured Chromium user data dir (${userDataDir})`
                : "Google Chrome's default profile";
            throw new BrowserProfileUnavailableError(`Chrome MCP existing-session attach failed for profile "${profileName}". ` +
                `Make sure ${targetLabel} is running locally with remote debugging enabled. ` +
                `Details: ${String(err)}`);
        }
    })();
    return {
        client,
        transport,
        ready,
    };
}
async function getSession(profileName, userDataDir) {
    const cacheKey = buildChromeMcpSessionCacheKey(profileName, userDataDir);
    await closeChromeMcpSessionsForProfile(profileName, cacheKey);
    let session = sessions.get(cacheKey);
    if (session && session.transport.pid === null) {
        sessions.delete(cacheKey);
        session = undefined;
    }
    if (!session) {
        let pending = pendingSessions.get(cacheKey);
        if (!pending) {
            pending = (async () => {
                const created = await (sessionFactory ?? createRealSession)(profileName, userDataDir);
                if (pendingSessions.get(cacheKey) === pending) {
                    sessions.set(cacheKey, created);
                }
                else {
                    await created.client.close().catch(() => { });
                }
                return created;
            })();
            pendingSessions.set(cacheKey, pending);
        }
        try {
            session = await pending;
        }
        finally {
            if (pendingSessions.get(cacheKey) === pending) {
                pendingSessions.delete(cacheKey);
            }
        }
    }
    try {
        await session.ready;
        return session;
    }
    catch (err) {
        const current = sessions.get(cacheKey);
        if (current?.transport === session.transport) {
            sessions.delete(cacheKey);
        }
        throw err;
    }
}
async function callTool(profileName, userDataDir, name, args = {}) {
    const cacheKey = buildChromeMcpSessionCacheKey(profileName, userDataDir);
    const session = await getSession(profileName, userDataDir);
    let result;
    try {
        result = (await session.client.callTool({
            name,
            arguments: args,
        }));
    }
    catch (err) {
        // Transport/connection error — tear down session so it reconnects on next call
        sessions.delete(cacheKey);
        await session.client.close().catch(() => { });
        throw err;
    }
    // Tool-level errors (element not found, script error, etc.) don't indicate a
    // broken connection — don't tear down the session for these.
    if (result.isError) {
        throw new Error(extractToolErrorMessage(result, name));
    }
    return result;
}
async function withTempFile(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-chrome-mcp-"));
    const filePath = path.join(dir, randomUUID());
    try {
        return await fn(filePath);
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}
async function findPageById(profileName, pageId, userDataDir) {
    const pages = await listChromeMcpPages(profileName, userDataDir);
    const page = pages.find((entry) => entry.id === pageId);
    if (!page) {
        throw new BrowserTabNotFoundError();
    }
    return page;
}
export async function ensureChromeMcpAvailable(profileName, userDataDir) {
    await getSession(profileName, userDataDir);
}
export function getChromeMcpPid(profileName) {
    for (const [key, session] of sessions.entries()) {
        if (cacheKeyMatchesProfileName(key, profileName)) {
            return session.transport.pid ?? null;
        }
    }
    return null;
}
export async function closeChromeMcpSession(profileName) {
    return await closeChromeMcpSessionsForProfile(profileName);
}
export async function stopAllChromeMcpSessions() {
    const names = [...new Set([...sessions.keys()].map((key) => JSON.parse(key)[0]))];
    for (const name of names) {
        await closeChromeMcpSession(name).catch(() => { });
    }
}
export async function listChromeMcpPages(profileName, userDataDir) {
    const result = await callTool(profileName, userDataDir, "list_pages");
    return extractStructuredPages(result);
}
export async function listChromeMcpTabs(profileName, userDataDir) {
    return toBrowserTabs(await listChromeMcpPages(profileName, userDataDir));
}
export async function openChromeMcpTab(profileName, url, userDataDir) {
    const result = await callTool(profileName, userDataDir, "new_page", { url });
    const pages = extractStructuredPages(result);
    const chosen = pages.find((page) => page.selected) ?? pages.at(-1);
    if (!chosen) {
        throw new Error("Chrome MCP did not return the created page.");
    }
    return {
        targetId: String(chosen.id),
        title: "",
        url: chosen.url ?? url,
        type: "page",
    };
}
export async function focusChromeMcpTab(profileName, targetId, userDataDir) {
    await callTool(profileName, userDataDir, "select_page", {
        pageId: parsePageId(targetId),
        bringToFront: true,
    });
}
export async function closeChromeMcpTab(profileName, targetId, userDataDir) {
    await callTool(profileName, userDataDir, "close_page", { pageId: parsePageId(targetId) });
}
export async function navigateChromeMcpPage(params) {
    await callTool(params.profileName, params.userDataDir, "navigate_page", {
        pageId: parsePageId(params.targetId),
        type: "url",
        url: params.url,
        ...(typeof params.timeoutMs === "number" ? { timeout: params.timeoutMs } : {}),
    });
    const page = await findPageById(params.profileName, parsePageId(params.targetId), params.userDataDir);
    return { url: page.url ?? params.url };
}
export async function takeChromeMcpSnapshot(params) {
    const result = await callTool(params.profileName, params.userDataDir, "take_snapshot", {
        pageId: parsePageId(params.targetId),
    });
    return extractSnapshot(result);
}
export async function takeChromeMcpScreenshot(params) {
    return await withTempFile(async (filePath) => {
        await callTool(params.profileName, params.userDataDir, "take_screenshot", {
            pageId: parsePageId(params.targetId),
            filePath,
            format: params.format ?? "png",
            ...(params.uid ? { uid: params.uid } : {}),
            ...(params.fullPage ? { fullPage: true } : {}),
        });
        return await fs.readFile(filePath);
    });
}
export async function clickChromeMcpElement(params) {
    await callTool(params.profileName, params.userDataDir, "click", {
        pageId: parsePageId(params.targetId),
        uid: params.uid,
        ...(params.doubleClick ? { dblClick: true } : {}),
    });
}
export async function fillChromeMcpElement(params) {
    await callTool(params.profileName, params.userDataDir, "fill", {
        pageId: parsePageId(params.targetId),
        uid: params.uid,
        value: params.value,
    });
}
export async function fillChromeMcpForm(params) {
    await callTool(params.profileName, params.userDataDir, "fill_form", {
        pageId: parsePageId(params.targetId),
        elements: params.elements,
    });
}
export async function hoverChromeMcpElement(params) {
    await callTool(params.profileName, params.userDataDir, "hover", {
        pageId: parsePageId(params.targetId),
        uid: params.uid,
    });
}
export async function dragChromeMcpElement(params) {
    await callTool(params.profileName, params.userDataDir, "drag", {
        pageId: parsePageId(params.targetId),
        from_uid: params.fromUid,
        to_uid: params.toUid,
    });
}
export async function uploadChromeMcpFile(params) {
    await callTool(params.profileName, params.userDataDir, "upload_file", {
        pageId: parsePageId(params.targetId),
        uid: params.uid,
        filePath: params.filePath,
    });
}
export async function pressChromeMcpKey(params) {
    await callTool(params.profileName, params.userDataDir, "press_key", {
        pageId: parsePageId(params.targetId),
        key: params.key,
    });
}
export async function resizeChromeMcpPage(params) {
    await callTool(params.profileName, params.userDataDir, "resize_page", {
        pageId: parsePageId(params.targetId),
        width: params.width,
        height: params.height,
    });
}
export async function handleChromeMcpDialog(params) {
    await callTool(params.profileName, params.userDataDir, "handle_dialog", {
        pageId: parsePageId(params.targetId),
        action: params.action,
        ...(params.promptText ? { promptText: params.promptText } : {}),
    });
}
export async function evaluateChromeMcpScript(params) {
    const result = await callTool(params.profileName, params.userDataDir, "evaluate_script", {
        pageId: parsePageId(params.targetId),
        function: params.fn,
        ...(params.args?.length ? { args: params.args } : {}),
    });
    return extractJsonMessage(result);
}
export async function waitForChromeMcpText(params) {
    await callTool(params.profileName, params.userDataDir, "wait_for", {
        pageId: parsePageId(params.targetId),
        text: params.text,
        ...(typeof params.timeoutMs === "number" ? { timeout: params.timeoutMs } : {}),
    });
}
export function setChromeMcpSessionFactoryForTest(factory) {
    sessionFactory = factory;
}
export async function resetChromeMcpSessionsForTest() {
    sessionFactory = null;
    pendingSessions.clear();
    await stopAllChromeMcpSessions();
}
