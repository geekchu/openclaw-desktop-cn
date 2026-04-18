import { beforeEach, describe, expect, it, vi } from "vitest";

const { getBootstrapChannelPluginMock, listPluginDoctorLegacyConfigRulesMock } = vi.hoisted(() => ({
  getBootstrapChannelPluginMock: vi.fn(),
  listPluginDoctorLegacyConfigRulesMock: vi.fn(() => []),
}));

vi.mock("./bootstrap-registry.js", () => ({
  getBootstrapChannelPlugin: (...args: unknown[]) => getBootstrapChannelPluginMock(...args),
}));

vi.mock("../../plugins/doctor-contract-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../plugins/doctor-contract-registry.js")>();
  return {
    ...actual,
    listPluginDoctorLegacyConfigRules: (...args: unknown[]) =>
      listPluginDoctorLegacyConfigRulesMock(...args),
  };
});

import { collectChannelLegacyConfigRules } from "./legacy-config.js";

describe("collectChannelLegacyConfigRules", () => {
  beforeEach(() => {
    getBootstrapChannelPluginMock.mockReset();
    listPluginDoctorLegacyConfigRulesMock.mockReset().mockReturnValue([]);
  });

  it("keeps bundled bootstrap channels off the dynamic doctor registry path", () => {
    getBootstrapChannelPluginMock.mockImplementation((channelId: string) =>
      channelId === "telegram"
        ? {
            doctor: {
              legacyConfigRules: [
                {
                  path: ["channels", "telegram", "legacyKey"],
                  message: "legacy telegram key",
                },
              ],
            },
          }
        : undefined,
    );

    const rules = collectChannelLegacyConfigRules({
      channels: {
        telegram: {},
        custom: {},
      },
    });

    expect(listPluginDoctorLegacyConfigRulesMock).toHaveBeenCalledWith({
      pluginIds: ["custom"],
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["channels", "telegram", "legacyKey"],
          message: "legacy telegram key",
        }),
      ]),
    );
  });
});
