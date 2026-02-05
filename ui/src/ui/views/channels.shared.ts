import { html, nothing } from "lit";
import type { ChannelAccountSnapshot } from "../types";
import type { ChannelKey, ChannelsProps } from "./channels.types";

export function formatDuration(ms?: number | null) {
  if (!ms && ms !== 0) return "无";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}分钟`;
  const hr = Math.round(min / 60);
  return `${hr}小时`;
}

export function channelEnabled(key: ChannelKey, props: ChannelsProps) {
  const snapshot = props.snapshot;
  const channels = snapshot?.channels as Record<string, unknown> | null;
  if (!snapshot || !channels) return false;
  const channelStatus = channels[key] as Record<string, unknown> | undefined;
  const configured = typeof channelStatus?.configured === "boolean" && channelStatus.configured;
  const running = typeof channelStatus?.running === "boolean" && channelStatus.running;
  const connected = typeof channelStatus?.connected === "boolean" && channelStatus.connected;
  const accounts = snapshot.channelAccounts?.[key] ?? [];
  const accountActive = accounts.some(
    (account) => account.configured || account.running || account.connected,
  );
  return configured || running || connected || accountActive;
}

export function getChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
): number {
  return channelAccounts?.[key]?.length ?? 0;
}

export function renderChannelAccountCount(
  key: ChannelKey,
  channelAccounts?: Record<string, ChannelAccountSnapshot[]> | null,
) {
  const count = getChannelAccountCount(key, channelAccounts);
  if (count < 2) return nothing;
  return html`<div class="account-count">账户 (${count})</div>`;
}
