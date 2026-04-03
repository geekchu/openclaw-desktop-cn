import { describe, expect, it } from "vitest";
import pluginEntry from "./index.js";

describe("wecom channel config adapter", () => {
  it("treats complete bot credentials as configured", () => {
    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          token: "wecom-token",
          encodingAesKey: "1234567890123456789012345678901234567890123",
        },
      },
    };

    const account = pluginEntry.channelPlugin!.config!.resolveAccount!(cfg, "default");

    expect(pluginEntry.channelPlugin!.config!.listAccountIds!(cfg)).toEqual(["default"]);
    expect(pluginEntry.channelPlugin!.config!.isConfigured!(account, cfg)).toBe(true);
  });

  it("does not mark incomplete credentials as configured", () => {
    const cfg = {
      channels: {
        wecom: {
          enabled: true,
          token: "wecom-token",
          encodingAesKey: "short",
        },
      },
    };

    const account = pluginEntry.channelPlugin!.config!.resolveAccount!(cfg, "default");

    expect(pluginEntry.channelPlugin!.config!.isConfigured!(account, cfg)).toBe(false);
  });

  it("treats config without an explicit enabled flag as enabled by default", () => {
    const cfg = {
      channels: {
        wecom: {
          token: "wecom-token",
          encodingAesKey: "1234567890123456789012345678901234567890123",
        },
      },
    };

    expect(pluginEntry.channelPlugin!.config!.listAccountIds!(cfg)).toEqual(["default"]);
    expect(pluginEntry.channelPlugin!.config!.defaultAccountId!(cfg)).toBe("default");
  });
});
