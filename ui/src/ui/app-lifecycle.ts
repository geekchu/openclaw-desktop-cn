import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import {
  observeTopbar,
  restoreChatScrollPosition,
  saveChatScrollPosition,
  scheduleChatScroll,
  scheduleLogsScroll,
} from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import { tabFromPath } from "./navigation.ts";
import type { Tab } from "./navigation.ts";

type LifecycleHost = {
  basePath: string;
  client?: { stop: () => void } | null;
  connected?: boolean;
  tab: Tab;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  messageHandler: ((event: MessageEvent) => void) | null;
  topbarObserver: ResizeObserver | null;
  setTab: (tab: Tab) => void;
};

export function handleConnected(host: LifecycleHost) {
  host.basePath = inferBasePath();
  void loadControlUiBootstrapConfig(host);
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);

  // Listen for navigation messages from embedded iframes (e.g. Manager "back to console")
  host.messageHandler = (event: MessageEvent) => {
    // Origin validation: allow same-origin, localhost, and Tauri sandbox ("null")
    const origin = event.origin;
    if (
      origin !== window.location.origin &&
      origin !== "null" &&
      !/^https?:\/\/localhost(:\d+)?$/.test(origin) &&
      !/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
    ) {
      return;
    }
    const data = event.data;
    if (data && typeof data === "object" && data.type === "openclaw:navigate") {
      const tab = typeof data.tab === "string" ? tabFromPath(`/${data.tab}`, host.basePath) : null;
      if (tab) {
        host.setTab(tab);
      }
    }
  };
  window.addEventListener("message", host.messageHandler);
  connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  window.removeEventListener("popstate", host.popStateHandler);
  if (host.messageHandler) {
    window.removeEventListener("message", host.messageHandler);
    host.messageHandler = null;
  }
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  host.client?.stop();
  host.client = null;
  host.connected = false;
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

/** Chat-related properties that should trigger scroll behavior */
const CHAT_SCROLL_PROPERTIES = new Set([
  "chatMessages",
  "chatToolMessages",
  "chatStream",
  "chatLoading",
  "tab",
]);

/**
 * Called before Lit update to save chat scroll position.
 * This is needed to work around macOS WebKit's lack of overflow-anchor support,
 * which can cause scroll position to jump unexpectedly during re-renders.
 */
export function handleWillUpdate(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  // Save scroll position for all changes on chat tab
  // macOS WebKit lacks overflow-anchor support, so we need to manually preserve scroll position
  if (host.tab !== "chat") {
    return;
  }
  saveChatScrollPosition(host as unknown as Parameters<typeof saveChatScrollPosition>[0]);
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  // Check if this is a chat-related change
  const isChatRelatedChange = Array.from(changed.keys()).some((key) =>
    CHAT_SCROLL_PROPERTIES.has(key as string),
  );

  // Always restore scroll position on chat tab to compensate for macOS WebKit's lack of overflow-anchor
  if (host.tab === "chat") {
    restoreChatScrollPosition(host as unknown as Parameters<typeof restoreChatScrollPosition>[0]);
  }

  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }

  if (host.tab === "chat" && isChatRelatedChange) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }

  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
