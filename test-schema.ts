import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "./src/agents/agent-scope.js";
import { loadConfig } from "./src/config/config.js";
import { loadOpenClawPlugins } from "./src/plugins/loader.js";

async function run() {
  console.log("Loading config...");
  const cfg = loadConfig();
  console.log("Config JSON length:", JSON.stringify(cfg).length);

  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  console.log("workspaceDir:", workspaceDir);

  console.log("Loading plugins...");
  try {
    const pluginRegistry = loadOpenClawPlugins({
      config: cfg,
      cache: false,
      workspaceDir,
      logger: { info: console.log, warn: console.warn, error: console.error, debug: console.log },
    });

    console.log("Plugins loaded:", pluginRegistry.plugins.length);

    console.log("Checking plugin schema lengths (hunting Invalid string length)...");
    for (const plugin of pluginRegistry.plugins) {
      const data = {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configUiHints: plugin.configUiHints,
        configSchema: plugin.configJsonSchema,
      };

      try {
        const str = JSON.stringify(data);
        if (str.length > 50000) {
          console.warn(`Huge plugin data: ${plugin.id} length: ${str.length}`);
        }
      } catch (err) {
        console.error(`Stringify failed for plugin: ${plugin.id}`);
      }
    }

    const pluginsData = pluginRegistry.plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      configUiHints: plugin.configUiHints,
      configSchema: plugin.configJsonSchema,
    }));

    console.log("Total pluginsData JSON length:", JSON.stringify(pluginsData).length);
  } catch (e) {
    console.error("Crash during plugins loading or stringify:", e);
  }
}

run().catch(console.error);
