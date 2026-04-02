import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logDebug, logWarn } from "../logger.js";
import { loadEmbeddedPiMcpConfig } from "./embedded-pi-mcp.js";
import { describeStdioMcpServerLaunchConfig, resolveStdioMcpServerLaunchConfig, } from "./mcp-stdio.js";
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function listAllTools(client) {
    const tools = [];
    let cursor;
    do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor);
    return tools;
}
function toAgentToolResult(params) {
    const content = Array.isArray(params.result.content)
        ? params.result.content
        : [];
    const normalizedContent = content.length > 0
        ? content
        : params.result.structuredContent !== undefined
            ? [
                {
                    type: "text",
                    text: JSON.stringify(params.result.structuredContent, null, 2),
                },
            ]
            : [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: params.result.isError === true ? "error" : "ok",
                        server: params.serverName,
                        tool: params.toolName,
                    }, null, 2),
                },
            ];
    const details = {
        mcpServer: params.serverName,
        mcpTool: params.toolName,
    };
    if (params.result.structuredContent !== undefined) {
        details.structuredContent = params.result.structuredContent;
    }
    if (params.result.isError === true) {
        details.status = "error";
    }
    return {
        content: normalizedContent,
        details,
    };
}
function attachStderrLogging(serverName, transport) {
    const stderr = transport.stderr;
    if (!stderr || typeof stderr.on !== "function") {
        return undefined;
    }
    const onData = (chunk) => {
        const message = String(chunk).trim();
        if (!message) {
            return;
        }
        for (const line of message.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) {
                logDebug(`bundle-mcp:${serverName}: ${trimmed}`);
            }
        }
    };
    stderr.on("data", onData);
    return () => {
        if (typeof stderr.off === "function") {
            stderr.off("data", onData);
        }
        else if (typeof stderr.removeListener === "function") {
            stderr.removeListener("data", onData);
        }
    };
}
async function disposeSession(session) {
    session.detachStderr?.();
    await session.client.close().catch(() => { });
    await session.transport.close().catch(() => { });
}
export async function createBundleMcpToolRuntime(params) {
    const loaded = loadEmbeddedPiMcpConfig({
        workspaceDir: params.workspaceDir,
        cfg: params.cfg,
    });
    for (const diagnostic of loaded.diagnostics) {
        logWarn(`bundle-mcp: ${diagnostic.pluginId}: ${diagnostic.message}`);
    }
    // Skip spawning when no MCP servers are configured.
    if (Object.keys(loaded.mcpServers).length === 0) {
        return { tools: [], dispose: async () => { } };
    }
    const reservedNames = new Set(Array.from(params.reservedToolNames ?? [], (name) => name.trim().toLowerCase()).filter(Boolean));
    const sessions = [];
    const tools = [];
    try {
        for (const [serverName, rawServer] of Object.entries(loaded.mcpServers)) {
            const launch = resolveStdioMcpServerLaunchConfig(rawServer);
            if (!launch.ok) {
                logWarn(`bundle-mcp: skipped server "${serverName}" because ${launch.reason}.`);
                continue;
            }
            const launchConfig = launch.config;
            const transport = new StdioClientTransport({
                command: launchConfig.command,
                args: launchConfig.args,
                env: launchConfig.env,
                cwd: launchConfig.cwd,
                stderr: "pipe",
            });
            const client = new Client({
                name: "openclaw-bundle-mcp",
                version: "0.0.0",
            }, {});
            const session = {
                serverName,
                client,
                transport,
                detachStderr: attachStderrLogging(serverName, transport),
            };
            try {
                await client.connect(transport);
                const listedTools = await listAllTools(client);
                sessions.push(session);
                for (const tool of listedTools) {
                    const normalizedName = tool.name.trim().toLowerCase();
                    if (!normalizedName) {
                        continue;
                    }
                    if (reservedNames.has(normalizedName)) {
                        logWarn(`bundle-mcp: skipped tool "${tool.name}" from server "${serverName}" because the name already exists.`);
                        continue;
                    }
                    reservedNames.add(normalizedName);
                    tools.push({
                        name: tool.name,
                        label: tool.title ?? tool.name,
                        description: tool.description?.trim() ||
                            `Provided by bundle MCP server "${serverName}" (${describeStdioMcpServerLaunchConfig(launchConfig)}).`,
                        parameters: tool.inputSchema,
                        execute: async (_toolCallId, input) => {
                            const result = (await client.callTool({
                                name: tool.name,
                                arguments: isRecord(input) ? input : {},
                            }));
                            return toAgentToolResult({
                                serverName,
                                toolName: tool.name,
                                result,
                            });
                        },
                    });
                }
            }
            catch (error) {
                logWarn(`bundle-mcp: failed to start server "${serverName}" (${describeStdioMcpServerLaunchConfig(launchConfig)}): ${String(error)}`);
                await disposeSession(session);
            }
        }
        return {
            tools,
            dispose: async () => {
                await Promise.allSettled(sessions.map((session) => disposeSession(session)));
            },
        };
    }
    catch (error) {
        await Promise.allSettled(sessions.map((session) => disposeSession(session)));
        throw error;
    }
}
