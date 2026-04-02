import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderChannels } from "./channels.ts";
import {
  channelEnabled,
  resolveChannelConfigured,
  resolveChannelDisplayState,
} from "./channels.shared.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { shouldShowWhatsAppLogout } from "./channels.whatsapp.ts";

function createProps(snapshot: ChannelsProps["snapshot"]): ChannelsProps {
  return {
    connected: true,
    loading: false,
    snapshot,
    lastError: null,
    lastSuccessAt: null,
    whatsappMessage: null,
    whatsappQrDataUrl: null,
    whatsappConnected: null,
    whatsappBusy: false,
    configSchema: null,
    configSchemaLoading: false,
    configForm: null,
    configUiHints: {},
    configSaving: false,
    configFormDirty: false,
    nostrProfileFormState: null,
    nostrProfileAccountId: null,
    onRefresh: () => {},
    onWhatsAppStart: () => {},
    onWhatsAppWait: () => {},
    onWhatsAppLogout: () => {},
    onConfigPatch: () => {},
    onConfigSave: () => {},
    onConfigReload: () => {},
    onNostrProfileEdit: () => {},
    onNostrProfileCancel: () => {},
    onNostrProfileFieldChange: () => {},
    onNostrProfileSave: () => {},
    onNostrProfileImport: () => {},
    onNostrProfileToggleAdvanced: () => {},
  };
}

async function renderChannelsView(snapshot: ChannelsProps["snapshot"]) {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderChannels(createProps(snapshot)), container);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return container;
}

describe("channel display selectors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the channel summary configured flag when present", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { configured: false } },
      channelAccounts: {
        discord: [{ accountId: "discord-main", configured: true }],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    expect(resolveChannelConfigured("discord", props)).toBe(false);
    expect(resolveChannelDisplayState("discord", props).configured).toBe(false);
  });

  it("falls back to the default account when the channel summary omits configured", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["discord"],
      channelLabels: { discord: "Discord" },
      channels: { discord: { running: true } },
      channelAccounts: {
        discord: [
          { accountId: "default", configured: false },
          { accountId: "discord-main", configured: true },
        ],
      },
      channelDefaultAccountId: { discord: "discord-main" },
    });

    const displayState = resolveChannelDisplayState("discord", props);

    expect(resolveChannelConfigured("discord", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("discord-main");
    expect(channelEnabled("discord", props)).toBe(true);
  });

  it("falls back to the first account when no default account id is available", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["slack"],
      channelLabels: { slack: "Slack" },
      channels: { slack: { running: true } },
      channelAccounts: {
        slack: [{ accountId: "workspace-a", configured: true }],
      },
      channelDefaultAccountId: {},
    });

    const displayState = resolveChannelDisplayState("slack", props);

    expect(resolveChannelConfigured("slack", props)).toBe(true);
    expect(displayState.defaultAccount?.accountId).toBe("workspace-a");
  });

  it("keeps disabled channels hidden when neither summary nor accounts are active", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["signal"],
      channelLabels: { signal: "Signal" },
      channels: { signal: {} },
      channelAccounts: {
        signal: [{ accountId: "default", configured: false, running: false, connected: false }],
      },
      channelDefaultAccountId: { signal: "default" },
    });

    const displayState = resolveChannelDisplayState("signal", props);

    expect(displayState.configured).toBe(false);
    expect(displayState.running).toBeNull();
    expect(displayState.connected).toBeNull();
    expect(channelEnabled("signal", props)).toBe(false);
  });

  it("hides WhatsApp logout when multiple WhatsApp accounts are present", () => {
    const props = createProps({
      ts: Date.now(),
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channels: { whatsapp: { configured: true } },
      channelAccounts: {
        whatsapp: [
          { accountId: "default", configured: true },
          { accountId: "work", configured: true },
        ],
      },
      channelDefaultAccountId: { whatsapp: "default" },
    });

    expect(shouldShowWhatsAppLogout(props)).toBe(false);
  });

  it("hides WhatsApp auth actions for multi-account setups in the view", async () => {
    const container = await renderChannelsView({
      ts: Date.now(),
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelMeta: [{ id: "whatsapp", label: "WhatsApp", detailLabel: "WhatsApp" }],
      channels: {
        whatsapp: {
          configured: true,
          linked: true,
          running: true,
          connected: true,
          reconnectAttempts: 0,
        },
      },
      channelAccounts: {
        whatsapp: [
          { accountId: "default", configured: true, linked: true, running: true, connected: true },
          { accountId: "work", configured: true, linked: true, running: true, connected: true },
        ],
      },
      channelDefaultAccountId: { whatsapp: "default" },
    });

    expect(container.textContent).toContain("Multi-account WhatsApp linking is not available");
    expect(container.textContent).not.toContain("Show QR");
    expect(container.textContent).not.toContain("Relink");
    expect(container.textContent).not.toContain("Wait for scan");
    expect(container.textContent).not.toContain("Logout");
  });

  it("renders the dedicated Feishu channel card in channels view", async () => {
    const container = await renderChannelsView({
      ts: Date.now(),
      channelOrder: ["feishu"],
      channelLabels: { feishu: "Feishu" },
      channelMeta: [{ id: "feishu", label: "Feishu", detailLabel: "Feishu" }],
      channels: {
        feishu: {
          configured: true,
          running: true,
          domain: "open.feishu.cn",
          appId: "cli_a123",
          probe: { ok: false, status: 401, error: "token expired" },
        },
      },
      channelAccounts: {
        feishu: [{ accountId: "default", configured: true, running: true }],
      },
      channelDefaultAccountId: { feishu: "default" },
    });

    expect(container.textContent).toContain("应用 ID");
    expect(container.textContent).toContain("open.feishu.cn");
    expect(container.textContent).toContain("token expired");
  });

  it("surfaces generic channel probe failures in the card", async () => {
    const container = await renderChannelsView({
      ts: Date.now(),
      channelOrder: ["matrix"],
      channelLabels: { matrix: "Matrix" },
      channelMeta: [{ id: "matrix", label: "Matrix", detailLabel: "Matrix" }],
      channels: {
        matrix: {
          configured: true,
          running: false,
          connected: false,
          lastProbeAt: Date.now(),
          probe: { ok: false, status: 503, error: "homeserver unreachable" },
        },
      },
      channelAccounts: {},
      channelDefaultAccountId: {},
    });

    expect(container.textContent).toContain("Probe failed");
    expect(container.textContent).toContain("503");
    expect(container.textContent).toContain("homeserver unreachable");
  });
});
