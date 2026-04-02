/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadConfig, loadConfigSchema } = vi.hoisted(() => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
  loadConfigSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/config.ts", () => ({
  loadConfig,
  loadConfigSchema,
}));

import { refreshActiveTab } from "./app-settings.ts";
import type { Tab } from "./navigation.ts";

type SettingsHost = Parameters<typeof refreshActiveTab>[0];

function createHost(tab: Tab): SettingsHost {
  return {
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      borderRadius: 50,
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: false,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    theme: "claw",
    themeMode: "system",
    themeResolved: "dark",
    applySessionKey: "main",
    sessionKey: "main",
    tab,
    connected: false,
    chatHasAutoScrolled: false,
    logsAtBottom: false,
    eventLog: [],
    eventLogBuffer: [],
    basePath: "",
  } as SettingsHost;
}

describe("refreshActiveTab message settings routing", () => {
  afterEach(() => {
    loadConfig.mockClear();
    loadConfigSchema.mockClear();
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__;
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("loads the schema-driven messages page on web", async () => {
    await refreshActiveTab(createHost("messages"));

    expect(loadConfigSchema).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it("skips schema loading for desktop messages", async () => {
    (window as typeof window & { __TAURI__?: unknown }).__TAURI__ = {};

    await refreshActiveTab(createHost("messages"));

    expect(loadConfigSchema).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("keeps the legacy communications alias on the desktop path", async () => {
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    await refreshActiveTab(createHost("communications"));

    expect(loadConfigSchema).not.toHaveBeenCalled();
    expect(loadConfig).not.toHaveBeenCalled();
  });
});
