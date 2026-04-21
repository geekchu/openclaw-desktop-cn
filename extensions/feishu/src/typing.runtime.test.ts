import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFeishuRuntimeAccountMock = vi.hoisted(() => vi.fn());
const createFeishuClientMock = vi.hoisted(() => vi.fn());
const tryGetFeishuRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("./accounts.js", () => ({
  resolveFeishuRuntimeAccount: resolveFeishuRuntimeAccountMock,
}));

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

vi.mock("./runtime.js", async () => {
  const actual = await vi.importActual<typeof import("./runtime.js")>("./runtime.js");
  return {
    ...actual,
    tryGetFeishuRuntime: tryGetFeishuRuntimeMock,
  };
});

import { addTypingIndicator, FeishuBackoffError, removeTypingIndicator } from "./typing.js";

describe("feishu typing runtime fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveFeishuRuntimeAccountMock.mockReturnValue({
      configured: true,
      accountId: "main",
      appId: "app-id",
      appSecret: "secret",
      domain: "feishu",
      config: {},
    });
    tryGetFeishuRuntimeMock.mockReturnValue(null);
  });

  it("does not throw runtime initialization errors for non-critical add failures", async () => {
    createFeishuClientMock.mockReturnValue({
      im: {
        messageReaction: {
          create: vi.fn(async () => {
            throw new Error("network timeout");
          }),
        },
      },
    });

    await expect(
      addTypingIndicator({
        cfg: {} as never,
        messageId: "om_parent",
        runtime: { log: vi.fn() } as never,
      }),
    ).resolves.toEqual({
      messageId: "om_parent",
      reactionId: null,
    });
  });

  it("preserves Feishu backoff errors when runtime store is unavailable", async () => {
    createFeishuClientMock.mockReturnValue({
      im: {
        messageReaction: {
          create: vi.fn(async () => ({ code: 99991403 })),
        },
      },
    });

    await expect(
      addTypingIndicator({
        cfg: {} as never,
        messageId: "om_parent",
        runtime: { log: vi.fn() } as never,
      }),
    ).rejects.toBeInstanceOf(FeishuBackoffError);
  });

  it("does not throw runtime initialization errors for non-critical remove failures", async () => {
    createFeishuClientMock.mockReturnValue({
      im: {
        messageReaction: {
          delete: vi.fn(async () => {
            throw new Error("permission denied");
          }),
        },
      },
    });

    await expect(
      removeTypingIndicator({
        cfg: {} as never,
        state: { messageId: "om_parent", reactionId: "reaction-1" },
        runtime: { log: vi.fn() } as never,
      }),
    ).resolves.toBeUndefined();
  });
});
