import { describe, expect, it } from "vitest";

import "./config-channels.ts";

type LegacyChannelConfig = {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

type LegacyChannelsElement = HTMLElement & {
  channels: LegacyChannelConfig[];
  configForm: Record<string, string>;
  handleChannelSelect: (channelId: string, channelList?: LegacyChannelConfig[]) => void;
  validateConfigBeforeSave: (
    channel: LegacyChannelConfig,
    config: Record<string, unknown>,
  ) => string | null;
  hasValidConfig: (channel: LegacyChannelConfig) => boolean;
};

function createElement(): LegacyChannelsElement {
  const ctor = customElements.get("openclaw-config-channels");
  if (!ctor) {
    throw new Error("openclaw-config-channels is not registered");
  }
  return new ctor() as LegacyChannelsElement;
}

describe("legacy config-channels validation", () => {
  it("keeps dingtalk card template fields in the form state", () => {
    const element = createElement();
    const channel: LegacyChannelConfig = {
      id: "dingtalk",
      channel_type: "dingtalk",
      enabled: true,
      config: {
        clientId: "ding-app",
        clientSecret: "ding-secret",
        messageType: "card",
        cardTemplateId: "tmpl.schema",
        cardTemplateKey: "msgContent",
      },
    };

    element.channels = [channel];
    element.handleChannelSelect(channel.id, [channel]);

    expect(element.configForm.cardTemplateId).toBe("tmpl.schema");
    expect(element.configForm.cardTemplateKey).toBe("msgContent");
  });

  it("rejects feishu webhook mode without webhook secrets", () => {
    const element = createElement();
    const channel: LegacyChannelConfig = {
      id: "feishu",
      channel_type: "feishu",
      enabled: true,
      config: {},
    };

    expect(
      element.validateConfigBeforeSave(channel, {
        appId: "cli_a123",
        appSecret: "secret",
        connectionMode: "webhook",
      }),
    ).toBe("Webhook 模式需要配置 Verification Token");

    expect(
      element.validateConfigBeforeSave(channel, {
        appId: "cli_a123",
        appSecret: "secret",
        connectionMode: "webhook",
        verificationToken: "verify-token",
      }),
    ).toBe("Webhook 模式需要配置 Encrypt Key");
  });

  it("rejects invalid wecom encoding aes key lengths", () => {
    const element = createElement();
    const channel: LegacyChannelConfig = {
      id: "wecom",
      channel_type: "wecom",
      enabled: true,
      config: {},
    };

    expect(
      element.validateConfigBeforeSave(channel, {
        token: "wecom-token",
        encodingAesKey: "short-key",
      }),
    ).toBe("EncodingAESKey 必须为 43 位");
  });

  it("treats dingtalk card mode without template id as not configured", () => {
    const element = createElement();
    const channel: LegacyChannelConfig = {
      id: "dingtalk",
      channel_type: "dingtalk",
      enabled: true,
      config: {
        clientId: "ding-app",
        clientSecret: "ding-secret",
        messageType: "card",
      },
    };

    expect(element.hasValidConfig(channel)).toBe(false);
    expect(
      element.validateConfigBeforeSave(channel, {
        clientId: "ding-app",
        clientSecret: "ding-secret",
        messageType: "card",
      }),
    ).toBe("AI 卡片模式需要配置卡片模板 ID");
  });

  it("treats qqbot clientSecretFile configs as valid existing credentials", () => {
    const element = createElement();
    const channel: LegacyChannelConfig = {
      id: "qqbot",
      channel_type: "qqbot",
      enabled: true,
      config: {
        appId: "qq-app",
        clientSecretFile: "/tmp/qqbot-secret.txt",
      },
    };

    expect(element.hasValidConfig(channel)).toBe(true);
    expect(
      element.validateConfigBeforeSave(channel, {
        appId: "qq-app",
        clientSecretFile: "/tmp/qqbot-secret.txt",
      }),
    ).toBeNull();
  });
});
