import { describe, expect, it } from "vitest";
import { mergeGatewayMethods } from "./server-methods-list.js";

describe("mergeGatewayMethods", () => {
  it("dedupes overlapping methods while preserving first-seen order", () => {
    const merged = mergeGatewayMethods(
      ["health", "sessions.list", "chat.send"],
      ["chat.send", "browser.request", "sessions.list", "discord.login"],
    );

    expect(merged).toEqual([
      "health",
      "sessions.list",
      "chat.send",
      "browser.request",
      "discord.login",
    ]);
  });
});
