import { formatDurationHuman } from "../../../src/infra/format-time/format-duration.ts";
import { formatRelativeTimestamp } from "../../../src/infra/format-time/format-relative.ts";
import { stripAssistantInternalScaffolding } from "../../../src/shared/text/assistant-visible-text.js";

export { formatRelativeTimestamp, formatDurationHuman };

export function formatMs(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return "无";
  }
  return new Date(ms).toLocaleString();
}

export function formatAgo(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return "无";
  }
  const diff = Date.now() - ms;
  const absDiff = Math.abs(diff);
  const suffix = diff < 0 ? "后" : "前";
  const sec = Math.round(absDiff / 1000);
  if (sec < 60) {
    return diff < 0 ? "刚刚" : `${sec}秒前`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}分钟${suffix}`;
  }
  const hr = Math.round(min / 60);
  if (hr < 48) {
    return `${hr}小时${suffix}`;
  }
  const day = Math.round(hr / 24);
  return `${day}天${suffix}`;
}

export function formatDurationMs(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return "无";
  }
  if (ms < 1000) {
    return `${ms}毫秒`;
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}秒`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}分钟`;
  }
  const hr = Math.round(min / 60);
  if (hr < 48) {
    return `${hr}小时`;
  }
  const day = Math.round(hr / 24);
  return `${day}天`;
}

export function formatList(values?: Array<string | null | undefined>): string {
  if (!values || values.length === 0) {
    return "无";
  }
  return values.filter((v): v is string => Boolean(v && v.trim())).join(", ");
}

export function clampText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateText(
  value: string,
  max: number,
): {
  text: string;
  truncated: boolean;
  total: number;
} {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

export function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function stripThinkingTags(value: string): string {
  return stripAssistantInternalScaffolding(value);
}

export function formatCost(cost: number | null | undefined, fallback = "$0.00"): string {
  if (cost == null || !Number.isFinite(cost)) {
    return fallback;
  }
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number | null | undefined, fallback = "0"): string {
  if (tokens == null || !Number.isFinite(tokens)) {
    return fallback;
  }
  if (tokens < 1000) {
    return String(Math.round(tokens));
  }
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  const m = tokens / 1_000_000;
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}

export function formatPercent(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return `${(value * 100).toFixed(1)}%`;
}
