import { describe, expect, it } from "vitest";
import { isBlockedTerminalCommand } from "./terminal-command-policy.ts";

describe("terminal command policy", () => {
  it("blocks direct openclaw self-update commands", () => {
    expect(isBlockedTerminalCommand("openclaw update")).toBe(true);
    expect(isBlockedTerminalCommand("openclaw uninstall")).toBe(true);
  });

  it("blocks npm global installs of openclaw", () => {
    expect(isBlockedTerminalCommand("npm i -g openclaw")).toBe(true);
    expect(isBlockedTerminalCommand("npm install -g openclaw")).toBe(true);
    expect(isBlockedTerminalCommand("npm install --global openclaw@latest")).toBe(true);
  });

  it("does not block unrelated npm installs", () => {
    expect(isBlockedTerminalCommand("npm i -g pnpm")).toBe(false);
    expect(isBlockedTerminalCommand("npm install openclaw")).toBe(false);
  });
});

