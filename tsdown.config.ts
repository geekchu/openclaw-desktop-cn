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
    // Build all plugin-sdk entry points declared in package.json exports
    entry: [
      "src/plugin-sdk/index.ts",
      "src/plugin-sdk/account-id.ts",
      "src/plugin-sdk/keyed-async-queue.ts",
      "src/plugin-sdk/acpx.ts",
      "src/plugin-sdk/bluebubbles.ts",
      "src/plugin-sdk/compat.ts",
      "src/plugin-sdk/copilot-proxy.ts",
      "src/plugin-sdk/core.ts",
      "src/plugin-sdk/device-pair.ts",
      "src/plugin-sdk/diagnostics-otel.ts",
      "src/plugin-sdk/diffs.ts",
      "src/plugin-sdk/discord.ts",
      "src/plugin-sdk/feishu.ts",
      "src/plugin-sdk/google-gemini-cli-auth.ts",
      "src/plugin-sdk/googlechat.ts",
      "src/plugin-sdk/imessage.ts",
      "src/plugin-sdk/irc.ts",
      "src/plugin-sdk/line.ts",
      "src/plugin-sdk/llm-task.ts",
      "src/plugin-sdk/lobster.ts",
      "src/plugin-sdk/matrix.ts",
      "src/plugin-sdk/mattermost.ts",
      "src/plugin-sdk/memory-core.ts",
      "src/plugin-sdk/memory-lancedb.ts",
      "src/plugin-sdk/minimax-portal-auth.ts",
      "src/plugin-sdk/msteams.ts",
      "src/plugin-sdk/nextcloud-talk.ts",
      "src/plugin-sdk/nostr.ts",
      "src/plugin-sdk/open-prose.ts",
      "src/plugin-sdk/phone-control.ts",
      "src/plugin-sdk/qwen-portal-auth.ts",
      "src/plugin-sdk/signal.ts",
      "src/plugin-sdk/slack.ts",
      "src/plugin-sdk/synology-chat.ts",
      "src/plugin-sdk/talk-voice.ts",
      "src/plugin-sdk/telegram.ts",
      "src/plugin-sdk/test-utils.ts",
      "src/plugin-sdk/thread-ownership.ts",
      "src/plugin-sdk/tlon.ts",
      "src/plugin-sdk/twitch.ts",
      "src/plugin-sdk/voice-call.ts",
      "src/plugin-sdk/whatsapp.ts",
      "src/plugin-sdk/zalo.ts",
      "src/plugin-sdk/zalouser.ts",
    ],
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
