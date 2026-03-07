import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectMediaTypeFromExtensionMock, sendProactiveMediaMock } = vi.hoisted(() => ({
  detectMediaTypeFromExtensionMock: vi.fn(),
  sendProactiveMediaMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk", () => ({
  buildChannelConfigSchema: vi.fn((schema: unknown) => schema),
}));

vi.mock("dingtalk-stream", () => ({
  DWClient: vi.fn(),
  TOPIC_ROBOT: "TOPIC_ROBOT",
}));

vi.mock("../../src/send-service", async () => ({
  detectMediaTypeFromExtension: detectMediaTypeFromExtensionMock,
  sendMessage: vi.fn(),
  sendProactiveMedia: sendProactiveMediaMock,
  sendBySession: vi.fn(),
  uploadMedia: vi.fn(),
}));

import { dingtalkPlugin } from "../../src/channel.js";

describe("(dingtalkPlugin as any).outbound.sendMedia flow", () => {
  beforeEach(() => {
    detectMediaTypeFromExtensionMock.mockReset();
    sendProactiveMediaMock.mockReset();
  });

  it("auto-detects mediaType and sends with resolved absolute path", async () => {
    detectMediaTypeFromExtensionMock.mockReturnValueOnce("image");
    sendProactiveMediaMock.mockResolvedValueOnce({
      ok: true,
      data: { processQueryKey: "media_1" },
      messageId: "media_1",
    });

    const result = await (dingtalkPlugin as any).outbound.sendMedia({
      cfg: { channels: { dingtalk: { clientId: "id", clientSecret: "sec" } } },
      to: "cidA1B2C3",
      mediaPath: "./fixtures/photo.png",
      accountId: "default",
    } as any);

    expect(detectMediaTypeFromExtensionMock).toHaveBeenCalledWith(
      path.resolve("./fixtures/photo.png"),
    );
    expect(sendProactiveMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "id" }),
      "cidA1B2C3",
      path.resolve("./fixtures/photo.png"),
      "image",
      expect.objectContaining({ accountId: "default" }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        channel: "dingtalk",
        messageId: "media_1",
      }),
    );
  });

  it("uses explicit mediaType without auto-detection", async () => {
    sendProactiveMediaMock.mockResolvedValueOnce({
      ok: true,
      data: { messageId: "manual_1" },
      messageId: "manual_1",
    });

    await (dingtalkPlugin as any).outbound.sendMedia({
      cfg: { channels: { dingtalk: { clientId: "id", clientSecret: "sec" } } },
      to: "user_123",
      mediaPath: "/tmp/voice.wav",
      mediaType: "voice",
      accountId: "default",
    } as any);

    expect(detectMediaTypeFromExtensionMock).not.toHaveBeenCalled();
    expect(sendProactiveMediaMock).toHaveBeenCalledWith(
      expect.any(Object),
      "user_123",
      "/tmp/voice.wav",
      "voice",
      expect.any(Object),
    );
  });

  it("throws when DingTalk send returns known error code", async () => {
    detectMediaTypeFromExtensionMock.mockReturnValueOnce("file");
    sendProactiveMediaMock.mockResolvedValueOnce({ ok: false, error: "DingTalk API error 300001" });

    await expect(
      (dingtalkPlugin as any).outbound.sendMedia({
        cfg: { channels: { dingtalk: { clientId: "id", clientSecret: "sec" } } },
        to: "cidA1B2C3",
        mediaPath: "/tmp/doc.pdf",
        accountId: "default",
      } as any),
    ).rejects.toThrow(/300001/);
  });
});
