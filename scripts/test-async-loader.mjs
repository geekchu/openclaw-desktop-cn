import { resolve } from "node:path";
import { loadConfig } from "../src/config/config.ts";
import { loadOpenClawPluginsAsync, loadOpenClawPlugins } from "../src/plugins/loader.ts";

async function run() {
  console.log("[test] Loading config...");
  const cfg = loadConfig();
  const workspaceDir = resolve("./");

  console.log("\n[test] 1. Running Sync loader...");
  const t1 = performance.now();
  const syncRegistry = loadOpenClawPlugins({
    config: cfg,
    workspaceDir,
    logger: console,
  });
  const t2 = performance.now();
  console.log(
    `[test] Sync loader finished in ${Math.round(t2 - t1)}ms. Plugins loaded: ${syncRegistry.plugins.filter((p) => p.status === "loaded").length}`,
  );

  console.log("\n[test] 2. Running Async loader...");
  const t3 = performance.now();
  const asyncRegistry = await loadOpenClawPluginsAsync({
    config: cfg,
    workspaceDir,
    // explicitly disable cache to force a fresh `jiti.import` call
    cache: false,
    logger: console,
  });
  const t4 = performance.now();
  console.log(
    `[test] Async loader finished in ${Math.round(t4 - t3)}ms. Plugins loaded: ${asyncRegistry.plugins.filter((p) => p.status === "loaded").length}`,
  );

  if (syncRegistry.plugins.length !== asyncRegistry.plugins.length) {
    console.error("[test] ERROR: Plugin counts differ!");
    process.exit(1);
  }

  console.log("\n[test] SUCCESS: Async loader produced the exact same number of loaded plugins.");
}

run().catch((err) => {
  console.error("Test failed unhandled:", err);
  process.exit(1);
});
