// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type PairingRequest = {
  code: string;
  id?: string;
  createdAt?: string;
};

type ConfigChannelsElement = HTMLElement & {
  channels: Array<{
    id: string;
    channel_type: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>;
  configForm: Record<string, string>;
  loading: boolean;
  selectedChannel: string;
  pairingLoading: boolean;
  pairingError: string | null;
  pairingRequests: PairingRequest[];
  approveLoading: boolean;
  approveResult: { success: boolean; message: string } | null;
  approveCode: string;
  _fetchPairingRequests: (channelId: string) => Promise<void>;
  _handleApproveCode: (channelId: string, code: string) => Promise<void>;
  handleSelectChange: (event: Event, key: string) => void;
  handleChannelSelect: (
    channelId: string,
    channelList?: Array<{
      id: string;
      channel_type: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }>,
  ) => void;
  init: (...args: unknown[]) => Promise<void>;
  updateComplete: Promise<boolean>;
  renderRoot: ShadowRoot;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
let previousTauri:
  | {
      core?: {
        invoke?: typeof invokeMock;
      };
    }
  | undefined;

beforeAll(async () => {
  previousTauri = (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__;

  (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__ = {
    core: {
      invoke: invokeMock,
    },
  };

  await import("./config-channels.ts");
});

afterAll(() => {
  (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__ = previousTauri;
});

afterEach(() => {
  invokeMock.mockReset();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function createElement(): ConfigChannelsElement {
  const ctor = customElements.get("openclaw-config-channels");
  if (!ctor) {
    throw new Error("openclaw-config-channels is not registered");
  }
  return new ctor() as ConfigChannelsElement;
}

function createChannels(ids: string[]) {
  return ids.map((id) => ({
    id,
    channel_type: id,
    enabled: true,
    config: {},
  }));
}

function createChannel(
  id: string,
  config: Record<string, unknown> = {},
): {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
} {
  return {
    id,
    channel_type: id,
    enabled: true,
    config,
  };
}

async function mountPairingElement(
  channelIds: string[] = ["discord"],
  selectedChannel = channelIds[0] ?? "",
) {
  const element = createElement();
  element.init = vi.fn(async () => {});
  element.channels = createChannels(channelIds);
  element.loading = false;
  element.configForm = {};
  element.selectedChannel = selectedChannel;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe("config-channels pairing refreshes", () => {
  it("keeps pairing behavior correct across the 9 displayed channels", async () => {
    const autoPairingChannels = ["telegram", "discord", "slack", "feishu", "imessage", "whatsapp"];
    for (const channelId of autoPairingChannels) {
      invokeMock.mockResolvedValueOnce([]);

      const element = await mountPairingElement([channelId], channelId);
      element.handleChannelSelect(channelId, [createChannel(channelId)]);
      await Promise.resolve();

      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenLastCalledWith("list_pairing_requests", { channel: channelId });
      expect(element.renderRoot.textContent).toContain("配对请求");

      document.body.innerHTML = "";
      invokeMock.mockReset();
    }

    for (const channelId of ["dingtalk", "qqbot", "wecom"]) {
      const element = await mountPairingElement([channelId], channelId);
      element.handleChannelSelect(channelId, [createChannel(channelId)]);
      await Promise.resolve();

      expect(invokeMock).not.toHaveBeenCalled();
      expect(element.renderRoot.textContent).not.toContain("配对请求");

      // Even with a stale dmPolicy:"pairing" saved in config, pairing must not trigger.
      element.handleChannelSelect(channelId, [createChannel(channelId, { dmPolicy: "pairing" })]);
      await Promise.resolve();

      expect(invokeMock).not.toHaveBeenCalled();
      expect(element.renderRoot.textContent).not.toContain("配对请求");

      document.body.innerHTML = "";
      invokeMock.mockReset();
    }
  });

  it("keeps the newest same-channel pairing response when refreshes overlap", async () => {
    const first = deferred<PairingRequest[]>();
    const second = deferred<PairingRequest[]>();
    invokeMock
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("list_pairing_requests");
        expect(args).toEqual({ channel: "discord" });
        return first.promise;
      })
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("list_pairing_requests");
        expect(args).toEqual({ channel: "discord" });
        return second.promise;
      });

    const element = await mountPairingElement();

    const firstFetch = element._fetchPairingRequests("discord");
    const secondFetch = element._fetchPairingRequests("discord");

    expect(element.pairingLoading).toBe(true);

    second.resolve([{ code: "NEW-CODE" }]);
    await secondFetch;

    expect(element.pairingRequests).toEqual([{ code: "NEW-CODE" }]);
    expect(element.pairingLoading).toBe(false);

    first.resolve([{ code: "OLD-CODE" }]);
    await firstFetch;

    expect(element.pairingRequests).toEqual([{ code: "NEW-CODE" }]);
    expect(element.pairingLoading).toBe(false);
  });

  it("does not let an older failed refresh clear newer same-channel results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = deferred<PairingRequest[]>();
    const second = deferred<PairingRequest[]>();
    invokeMock
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);

    const element = await mountPairingElement();

    const firstFetch = element._fetchPairingRequests("discord");
    const secondFetch = element._fetchPairingRequests("discord");

    second.resolve([{ code: "NEW-CODE" }]);
    await secondFetch;

    first.reject(new Error("timed out"));
    await firstFetch;

    expect(element.pairingRequests).toEqual([{ code: "NEW-CODE" }]);
    expect(element.pairingLoading).toBe(false);
    expect(element.pairingError).toBeNull();
  });

  it("keeps previous results and shows an error when the latest refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error("timed out"));

    const element = await mountPairingElement();
    element.pairingRequests = [{ code: "OLD-CODE" }];

    await element._fetchPairingRequests("discord");
    await element.updateComplete;

    expect(element.pairingRequests).toEqual([{ code: "OLD-CODE" }]);
    expect(element.pairingError).toBe("刷新失败，请稍后重试");
    expect(element.renderRoot.textContent).toContain("OLD-CODE");
    expect(element.renderRoot.textContent).toContain("刷新失败，请稍后重试");
  });

  it("shows only the refresh error when the first load fails with no cached results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error("timed out"));

    const element = await mountPairingElement();
    element.pairingRequests = [];

    await element._fetchPairingRequests("discord");
    await element.updateComplete;

    expect(element.pairingRequests).toEqual([]);
    expect(element.pairingError).toBe("刷新失败，请稍后重试");
    expect(element.renderRoot.textContent).toContain("刷新失败，请稍后重试");
    expect(element.renderRoot.textContent).not.toContain("暂无待审批的配对请求");
  });

  it("does not refresh an old channel after approval succeeds on a different selected channel", async () => {
    const approve = deferred<{ success: boolean; message: string }>();
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      expect(cmd).toBe("approve_pairing_code");
      expect(args).toEqual({ channel: "discord", code: "ABC123" });
      return approve.promise;
    });

    const element = createElement();
    element.selectedChannel = "discord";

    const approvePromise = element._handleApproveCode("discord", "ABC123");

    element.selectedChannel = "slack";
    approve.resolve({ success: true, message: "ok" });
    await approvePromise;

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(element.pairingLoading).toBe(false);
    expect(element.pairingError).toBeNull();
  });

  it("does not leak stale approval state into a newly selected channel", async () => {
    const approve = deferred<{ success: boolean; message: string }>();
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      expect(cmd).toBe("approve_pairing_code");
      expect(args).toEqual({ channel: "discord", code: "ABC123" });
      return approve.promise;
    });

    const channels = [
      {
        id: "discord",
        channel_type: "discord",
        enabled: true,
        config: {},
      },
      {
        id: "wecom",
        channel_type: "wecom",
        enabled: true,
        config: {},
      },
    ];
    const element = createElement();
    element.channels = channels;
    element.selectedChannel = "discord";

    const approvePromise = element._handleApproveCode("discord", "ABC123");
    expect(element.approveLoading).toBe(true);

    element.handleChannelSelect("wecom", channels);
    expect(element.approveLoading).toBe(false);
    expect(element.approveResult).toBeNull();

    approve.resolve({ success: true, message: "approved" });
    await approvePromise;

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(element.selectedChannel).toBe("wecom");
    expect(element.approveLoading).toBe(false);
    expect(element.approveResult).toBeNull();
    expect(element.pairingLoading).toBe(false);
  });

  it("keeps a newly typed approval code when an older approval succeeds", async () => {
    const approve = deferred<{ success: boolean; message: string }>();
    const refresh = deferred<PairingRequest[]>();
    invokeMock
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("approve_pairing_code");
        expect(args).toEqual({ channel: "discord", code: "ABC123" });
        return approve.promise;
      })
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("list_pairing_requests");
        expect(args).toEqual({ channel: "discord" });
        return refresh.promise;
      });

    const element = createElement();
    element.selectedChannel = "discord";
    element.approveCode = "ABC123";

    const approvePromise = element._handleApproveCode("discord", "ABC123");
    element.approveCode = "NEW456";

    approve.resolve({ success: true, message: "ok" });
    refresh.resolve([]);
    await approvePromise;

    expect(element.approveCode).toBe("NEW456");
    expect(element.approveResult).toEqual({ success: true, message: "ok" });
  });

  it("removes an approved request even when the follow-up refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock
      .mockResolvedValueOnce({ success: true, message: "ok" })
      .mockRejectedValueOnce(new Error("timed out"));

    const element = await mountPairingElement();
    element.pairingRequests = [{ code: "ABC123" }, { code: "KEEP456" }];
    element.approveCode = "ABC123";

    await element._handleApproveCode("discord", "ABC123");
    await Promise.resolve();
    await element.updateComplete;

    expect(element.pairingRequests).toEqual([{ code: "KEEP456" }]);
    expect(element.approveCode).toBe("");
    expect(element.approveResult).toEqual({ success: true, message: "ok" });
    expect(element.pairingError).toBe("刷新失败，请稍后重试");
  });

  it("treats manual approval codes case-insensitively for local cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invokeMock
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("approve_pairing_code");
        expect(args).toEqual({ channel: "discord", code: "ABC123" });
        return { success: true, message: "ok" };
      })
      .mockRejectedValueOnce(new Error("timed out"));

    const element = await mountPairingElement();
    element.pairingRequests = [{ code: "ABC123" }, { code: "KEEP456" }];
    element.approveCode = "abc123";

    await element._handleApproveCode("discord", " abc123 ");
    await Promise.resolve();
    await element.updateComplete;

    expect(element.pairingRequests).toEqual([{ code: "KEEP456" }]);
    expect(element.approveCode).toBe("");
    expect(element.approveResult).toEqual({ success: true, message: "ok" });
    expect(element.pairingError).toBe("刷新失败，请稍后重试");
  });

  it("ignores a second approval attempt while one is already in flight", async () => {
    const approve = deferred<{ success: boolean; message: string }>();
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      expect(cmd).toBe("approve_pairing_code");
      expect(args).toEqual({ channel: "discord", code: "ABC123" });
      return approve.promise;
    });

    const element = createElement();
    element.selectedChannel = "discord";

    const firstApprove = element._handleApproveCode("discord", "ABC123");
    await Promise.resolve();

    await element._handleApproveCode("discord", "ABC123");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(element.approveLoading).toBe(true);

    approve.resolve({ success: true, message: "ok" });
    await firstApprove;

    expect(element.approveLoading).toBe(false);
    expect(element.approveResult).toEqual({ success: true, message: "ok" });
  });

  it("ignores an already-queued stale fetch after switching channels", async () => {
    const currentFetch = deferred<PairingRequest[]>();
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      expect(cmd).toBe("list_pairing_requests");
      expect(args).toEqual({ channel: "slack" });
      return currentFetch.promise;
    });

    const element = await mountPairingElement(["slack", "discord"], "slack");

    const slackFetch = element._fetchPairingRequests("slack");
    expect(element.pairingLoading).toBe(true);

    await element._fetchPairingRequests("discord");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(element.pairingLoading).toBe(true);

    currentFetch.resolve([{ code: "SLACK-CODE" }]);
    await slackFetch;

    expect(element.pairingRequests).toEqual([{ code: "SLACK-CODE" }]);
    expect(element.pairingLoading).toBe(false);
    expect(element.pairingError).toBeNull();
  });

  it("does not start a queued pairing fetch after the element disconnects", async () => {
    const element = await mountPairingElement();

    element.remove();
    await Promise.resolve();

    await element._fetchPairingRequests("discord");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(element.pairingLoading).toBe(false);
  });

  it("does not start a same-channel fetch after pairing mode is turned off", async () => {
    const element = await mountPairingElement();
    element.configForm = { dmPolicy: "allowlist" };
    await element.updateComplete;

    await element._fetchPairingRequests("discord");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(element.pairingLoading).toBe(false);
    expect(element.pairingError).toBeNull();
  });

  it("does not let a stale approval success refresh after pairing mode is turned off", async () => {
    const approve = deferred<{ success: boolean; message: string }>();
    invokeMock.mockImplementationOnce(async (cmd, args) => {
      expect(cmd).toBe("approve_pairing_code");
      expect(args).toEqual({ channel: "discord", code: "ABC123" });
      return approve.promise;
    });

    const element = await mountPairingElement();
    element.selectedChannel = "discord";
    element.configForm = {};

    const approvePromise = element._handleApproveCode("discord", "ABC123");
    expect(element.approveLoading).toBe(true);

    element.configForm = { dmPolicy: "allowlist" };
    element.handleSelectChange({ target: { value: "allowlist" } } as unknown as Event, "dmPolicy");
    expect(element.approveLoading).toBe(false);
    expect(element.approveResult).toBeNull();

    approve.resolve({ success: true, message: "approved" });
    await approvePromise;

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(element.approveLoading).toBe(false);
    expect(element.approveResult).toBeNull();
    expect(element.pairingLoading).toBe(false);
  });
});
