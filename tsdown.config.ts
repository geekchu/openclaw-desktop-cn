import type { InputOptions } from "rolldown";
import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

const onBundlerLog: NonNullable<InputOptions["onLog"]> = (level, log, defaultHandler) => {
  if (log.code === "INEFFECTIVE_DYNAMIC_IMPORT") {
    return;
  }
  defaultHandler(level, log);
};

const shared = {
  env,
  fixedExtension: false,
  inputOptions: {
    onLog: onBundlerLog,
  },
  platform: "node" as const,
  outputOptions: { strictExecutionOrder: true },
  shims: true, // Enable ESM shims to fix module initialization order issues
};

export default defineConfig([
  {
    entry: "src/index.ts",
    ...shared,
  },
  {
    entry: "src/entry.ts",
    ...shared,
  },
  {
    // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
    entry: "src/cli/daemon-cli.ts",
    ...shared,
  },
  {
    entry: "src/infra/warning-filter.ts",
    ...shared,
  },
  {
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: "src/plugin-sdk/account-id.ts",
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: "src/plugin-sdk/keyed-async-queue.ts",
    outDir: "dist/plugin-sdk",
    ...shared,
  },
  {
    entry: "src/extensionAPI.ts",
    ...shared,
  },
  {
    entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
    ...shared,
  },
]);
