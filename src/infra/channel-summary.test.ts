import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyPluginRegistry, type PluginRegistry } from "../plugins/registry.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import { buildChannelSummary } from "./channel-summary.js";

describe("buildChannelSummary", () => {
  let previousRegistry: PluginRegistry | null = null;

  beforeEach(() => {
    previousRegistry = getActivePluginRegistry();
  });

  afterEach(() => {
    setActivePluginRegistry(previousRegistry ?? createEmptyPluginRegistry());
  });

  it("keeps rendering when one plugin crashes", async () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "telegram",
          source: "test",
          plugin: {
            ...createChannelTestPluginBase({
              id: "telegram",
              label: "Telegram",
              config: {
                listAccountIds: () => ["default"],
                resolveAccount: () => ({ configured: true }),
                isConfigured: async () => true,
              },
            }),
          },
        },
        {
          pluginId: "broken",
          source: "test",
          plugin: {
            ...createChannelTestPluginBase({
              id: "broken",
              label: "Broken",
              config: {
                listAccountIds: () => ["default"],
                resolveAccount: () => {
                  throw new TypeError("Cannot read properties of undefined (reading 'get')");
                },
              },
            }),
          },
        },
      ]),
    );

    const lines = await buildChannelSummary({}, { colorize: false });

    expect(lines).toContain("Telegram: configured");
    expect(
      lines.some((line) =>
        line.includes("Broken: error (Cannot read properties of undefined (reading 'get'))"),
      ),
    ).toBe(true);
  });
});
