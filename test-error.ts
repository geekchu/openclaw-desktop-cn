import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "./src/agents/agent-scope.js";
import { listChannelPlugins } from "./src/channels/plugins/index.js";
import { readConfigFileSnapshot } from "./src/config/config.js";
import { loadConfig } from "./src/config/config.js";
import { redactConfigSnapshot } from "./src/config/redact-snapshot.js";
import { buildConfigSchema } from "./src/config/schema.js";
import { loadOpenClawPlugins } from "./src/plugins/loader.js";

function loadSchemaWithPlugins() {
  const cfg = loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const pluginRegistry = loadOpenClawPlugins({
    config: cfg,
    cache: true,
    workspaceDir,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  return buildConfigSchema({
    plugins: pluginRegistry.plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      configUiHints: plugin.configUiHints,
      configSchema: plugin.configJsonSchema,
    })),
    channels: listChannelPlugins().map((entry) => ({
      id: entry.id,
      label: entry.meta.label,
      description: entry.meta.blurb,
      configSchema: entry.configSchema?.schema,
      configUiHints: entry.configSchema?.uiHints,
    })),
  });
}

async function testConfigGet() {
  try {
    console.log("Reading snapshot...");
    const snapshot = await readConfigFileSnapshot();
    console.log("Loading schema...");
    const schema = loadSchemaWithPlugins();
    console.log("Redacting...");
    const redacted = redactConfigSnapshot(snapshot, schema.uiHints);
    console.log("Slimming...");
    const { parsed: _p, resolved: _r, ...slim } = redacted;
    console.log("Stringifying...");
    const str = JSON.stringify(slim);
    console.log("Success! Length:", str.length);
  } catch (err) {
    console.error("ERROR CAUGHT IN EXACT BLOCK:", err);
  }
}

testConfigGet().catch(console.error);
