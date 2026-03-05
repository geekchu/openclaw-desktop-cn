import { loadConfig } from "./src/config/config.js";
import { loadOpenClawPlugins } from "./src/plugins/loader.js";

async function main() {
  console.time("plugins");
  const cfg = loadConfig();
  const registry = loadOpenClawPlugins({ config: cfg });
  console.timeEnd("plugins");
  console.log("Loaded plugins:", registry.plugins.length);
}

main().catch(console.error);
