const KEY = "openclaw.control.settings.v1";
const LEGACY_TOKEN_SESSION_KEY = "openclaw.control.token.v1";
const TOKEN_SESSION_KEY_PREFIX = `${LEGACY_TOKEN_SESSION_KEY}:`;
const MAX_SESSION_SCOPES = 10;

import { isSupportedLocale } from "../i18n/index.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "./navigation.ts";
import {
  parseThemeSelection,
  type ThemeMode,
  type ThemeName,
  VALID_THEME_NAMES,
} from "./theme.ts";

export type BorderRadiusStop = 0 | 25 | 50 | 75 | 100;
export const BORDER_RADIUS_STOPS: BorderRadiusStop[] = [0, 25, 50, 75, 100];

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  borderRadius: number;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  splitRatio: number;
  navCollapsed: boolean;
  navWidth?: number;
  navGroupsCollapsed: Record<string, boolean>;
  locale?: string;
};

type GatewaySessionSelection = {
  sessionKey: string;
  lastActiveSessionKey: string;
};

type PersistedUiSettings = {
  gatewayUrl?: unknown;
  token?: unknown;
  sessionKey?: unknown;
  lastActiveSessionKey?: unknown;
  theme?: unknown;
  themeMode?: unknown;
  borderRadius?: unknown;
  chatFocusMode?: unknown;
  chatShowThinking?: unknown;
  chatShowToolCalls?: unknown;
  splitRatio?: unknown;
  navCollapsed?: unknown;
  navWidth?: unknown;
  navGroupsCollapsed?: unknown;
  locale?: unknown;
  sessionsByGateway?: unknown;
};

function deriveDefaultGatewayUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const configured =
    typeof window !== "undefined" &&
    typeof window.__OPENCLAW_CONTROL_UI_BASE_PATH__ === "string" &&
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__.trim();
  const basePath = configured
    ? normalizeBasePath(configured)
    : inferBasePathFromPathname(location.pathname);
  return `${proto}://${location.host}${basePath}`;
}

function buildDefaultSettings(gatewayUrl: string): UiSettings {
  return {
    gatewayUrl,
    token: loadSessionToken(gatewayUrl),
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    borderRadius: 50,
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
  };
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Ignore host environments that expose window but block sessionStorage.
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage;
    }
  } catch {
    // Ignore missing global sessionStorage.
  }
  return null;
}

function normalizeGatewayStorageScope(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function scopedStorageKey(gatewayUrl: string): string {
  return `${KEY}:${normalizeGatewayStorageScope(gatewayUrl)}`;
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayStorageScope(gatewayUrl)}`;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && VALID_THEME_NAMES.includes(value as ThemeName);
}

function isBorderRadiusStop(value: unknown): value is BorderRadiusStop {
  return typeof value === "number" && BORDER_RADIUS_STOPS.includes(value as BorderRadiusStop);
}

function readPersistedSettings(key: string): PersistedUiSettings | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PersistedUiSettings;
  } catch {
    return null;
  }
}

function loadSessionToken(gatewayUrl: string): string {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return "";
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    return (storage.getItem(tokenSessionKeyForGateway(gatewayUrl)) ?? "").trim();
  } catch {
    return "";
  }
}

function persistSessionToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = token.trim();
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // Best-effort only.
  }
}

function normalizeSessionSelection(
  selection: Partial<GatewaySessionSelection> | null | undefined,
  defaults: UiSettings,
): GatewaySessionSelection {
  const sessionKey =
    typeof selection?.sessionKey === "string" && selection.sessionKey.trim()
      ? selection.sessionKey.trim()
      : defaults.sessionKey;
  const lastActiveSessionKey =
    typeof selection?.lastActiveSessionKey === "string" && selection.lastActiveSessionKey.trim()
      ? selection.lastActiveSessionKey.trim()
      : sessionKey;
  return { sessionKey, lastActiveSessionKey };
}

function parseGatewaySessions(raw: unknown): Array<[string, GatewaySessionSelection]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  const entries: Array<[string, GatewaySessionSelection]> = [];
  for (const [gatewayUrl, selection] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof gatewayUrl !== "string" || !gatewayUrl.trim()) {
      continue;
    }
    const session =
      selection && typeof selection === "object" && !Array.isArray(selection)
        ? normalizeSessionSelection(selection as Partial<GatewaySessionSelection>, {
            ...buildDefaultSettings(gatewayUrl),
            gatewayUrl,
          })
        : null;
    if (session) {
      entries.push([gatewayUrl, session]);
    }
  }
  return entries;
}

function resolveThemeSettings(
  parsed: PersistedUiSettings,
  defaults: UiSettings,
): Pick<UiSettings, "theme" | "themeMode"> {
  if (isThemeName(parsed.theme) && isThemeMode(parsed.themeMode)) {
    return { theme: parsed.theme, themeMode: parsed.themeMode };
  }
  const legacy = parseThemeSelection(
    typeof parsed.theme === "string" ? parsed.theme : undefined,
    undefined,
  );
  return {
    theme: isThemeName(legacy.theme) ? legacy.theme : defaults.theme,
    themeMode: isThemeMode(legacy.mode) ? legacy.mode : defaults.themeMode,
  };
}

function hydrateSettings(
  parsed: PersistedUiSettings,
  defaults: UiSettings,
  fallbackGatewayUrl: string,
): UiSettings {
  const gatewayUrl =
    typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
      ? parsed.gatewayUrl.trim()
      : fallbackGatewayUrl;
  const gatewayDefaults = buildDefaultSettings(gatewayUrl);
  const { theme, themeMode } = resolveThemeSettings(parsed, gatewayDefaults);
  const sessionEntries = parseGatewaySessions(parsed.sessionsByGateway);
  const persistedSession = sessionEntries.find(([key]) => key === gatewayUrl)?.[1];
  const legacySession = normalizeSessionSelection(
    {
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : undefined,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" ? parsed.lastActiveSessionKey : undefined,
    },
    gatewayDefaults,
  );
  const sessionSelection =
    persistedSession ??
    (typeof parsed.sessionKey === "string" || typeof parsed.lastActiveSessionKey === "string"
      ? legacySession
      : normalizeSessionSelection(undefined, gatewayDefaults));

  return {
    gatewayUrl,
    token: loadSessionToken(gatewayUrl),
    sessionKey: sessionSelection.sessionKey,
    lastActiveSessionKey: sessionSelection.lastActiveSessionKey,
    theme,
    themeMode,
    borderRadius: isBorderRadiusStop(parsed.borderRadius)
      ? parsed.borderRadius
      : gatewayDefaults.borderRadius,
    chatFocusMode:
      typeof parsed.chatFocusMode === "boolean"
        ? parsed.chatFocusMode
        : gatewayDefaults.chatFocusMode,
    chatShowThinking:
      typeof parsed.chatShowThinking === "boolean"
        ? parsed.chatShowThinking
        : gatewayDefaults.chatShowThinking,
    chatShowToolCalls:
      typeof parsed.chatShowToolCalls === "boolean"
        ? parsed.chatShowToolCalls
        : gatewayDefaults.chatShowToolCalls,
    splitRatio:
      typeof parsed.splitRatio === "number" &&
      parsed.splitRatio >= 0.4 &&
      parsed.splitRatio <= 0.7
        ? parsed.splitRatio
        : gatewayDefaults.splitRatio,
    navCollapsed:
      typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : gatewayDefaults.navCollapsed,
    navWidth:
      typeof parsed.navWidth === "number" && Number.isFinite(parsed.navWidth) && parsed.navWidth > 0
        ? parsed.navWidth
        : gatewayDefaults.navWidth,
    navGroupsCollapsed:
      typeof parsed.navGroupsCollapsed === "object" &&
      parsed.navGroupsCollapsed !== null &&
      !Array.isArray(parsed.navGroupsCollapsed)
        ? (parsed.navGroupsCollapsed as Record<string, boolean>)
        : gatewayDefaults.navGroupsCollapsed,
    locale: isSupportedLocale(parsed.locale as string) ? parsed.locale as NonNullable<UiSettings["locale"]> : undefined,
  };
}

function shouldNormalizePersistedShape(parsed: PersistedUiSettings): boolean {
  return (
    "token" in parsed ||
    "sessionKey" in parsed ||
    "lastActiveSessionKey" in parsed ||
    !parsed.sessionsByGateway
  );
}

export function loadSettings(): UiSettings {
  const defaultUrl = deriveDefaultGatewayUrl();
  const defaults = buildDefaultSettings(defaultUrl);
  const rootParsed = readPersistedSettings(KEY);
  const initialGatewayUrl =
    typeof rootParsed?.gatewayUrl === "string" && rootParsed.gatewayUrl.trim()
      ? rootParsed.gatewayUrl.trim()
      : defaultUrl;
  const scopedParsed = readPersistedSettings(scopedStorageKey(initialGatewayUrl));
  if (scopedParsed) {
    const settings = hydrateSettings(scopedParsed, defaults, initialGatewayUrl);
    if (shouldNormalizePersistedShape(scopedParsed)) {
      persistSettings(settings);
    }
    return settings;
  }

  if (rootParsed) {
    const settings = hydrateSettings(rootParsed, defaults, initialGatewayUrl);
    persistSettings(settings);
    return settings;
  }

  return defaults;
}

export function saveSettings(next: UiSettings) {
  persistSettings(next);
}

function persistSettings(next: UiSettings) {
  const gatewayUrl = next.gatewayUrl.trim() || deriveDefaultGatewayUrl();
  const settings: UiSettings = {
    ...buildDefaultSettings(gatewayUrl),
    ...next,
    gatewayUrl,
    token: next.token.trim(),
    sessionKey: next.sessionKey.trim() || "main",
    lastActiveSessionKey: next.lastActiveSessionKey.trim() || next.sessionKey.trim() || "main",
    navWidth:
      typeof next.navWidth === "number" && Number.isFinite(next.navWidth) && next.navWidth > 0
        ? next.navWidth
        : 220,
    borderRadius: isBorderRadiusStop(next.borderRadius) ? next.borderRadius : 50,
  };

  persistSessionToken(gatewayUrl, settings.token);

  const existing = readPersistedSettings(scopedStorageKey(gatewayUrl));
  const sessionEntries = parseGatewaySessions(existing?.sessionsByGateway);
  const nextSessions = sessionEntries.filter(([key]) => key !== gatewayUrl);
  nextSessions.push([
    gatewayUrl,
    {
      sessionKey: settings.sessionKey,
      lastActiveSessionKey: settings.lastActiveSessionKey,
    },
  ]);

  const cappedSessions = Object.fromEntries(nextSessions.slice(-MAX_SESSION_SCOPES));
  const persisted = {
    gatewayUrl,
    theme: settings.theme,
    themeMode: settings.themeMode,
    borderRadius: settings.borderRadius,
    chatFocusMode: settings.chatFocusMode,
    chatShowThinking: settings.chatShowThinking,
    chatShowToolCalls: settings.chatShowToolCalls,
    splitRatio: settings.splitRatio,
    navCollapsed: settings.navCollapsed,
    navWidth: settings.navWidth,
    navGroupsCollapsed: settings.navGroupsCollapsed,
    sessionsByGateway: cappedSessions,
    ...(settings.locale ? { locale: settings.locale } : {}),
  };

  localStorage.setItem(scopedStorageKey(gatewayUrl), JSON.stringify(persisted));
  localStorage.setItem(KEY, JSON.stringify({ gatewayUrl }));
}
