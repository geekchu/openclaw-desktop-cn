import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";

type NavigationModule = typeof import("./navigation.ts");

describe("TAB_GROUPS", () => {
  let navigation: NavigationModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    navigation = await import("./navigation.ts");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes the published settings tabs in the sidebar", () => {
    const settings = navigation.TAB_GROUPS.find((group) => group.label === "settings");
    expect(settings?.tabs).toEqual([
      "config",
      "onestop",
      "messages",
      "systemSettings",
      "debug",
      "logs",
    ]);
  });

  it("routes every published settings slice", () => {
    expect(navigation.tabFromPath("/config")).toBe("config");
    expect(navigation.tabFromPath("/onestop")).toBe("onestop");
    expect(navigation.tabFromPath("/messages")).toBe("messages");
    expect(navigation.tabFromPath("/system-settings")).toBe("systemSettings");
    expect(navigation.tabFromPath("/debug")).toBe("debug");
    expect(navigation.tabFromPath("/logs")).toBe("logs");
  });
});
