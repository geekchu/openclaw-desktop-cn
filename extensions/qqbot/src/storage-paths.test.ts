import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("qqbot storage paths", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores known users and sessions under OPENCLAW_STATE_DIR", async () => {
    const stateRoot = fs.mkdtempSync(path.join(process.cwd(), ".tmp-qqbot-storage-"));
    createdDirs.push(stateRoot);
    vi.stubEnv("OPENCLAW_STATE_DIR", stateRoot);

    const knownUsers = await import("./known-users.js");
    const sessionStore = await import("./session-store.js");

    knownUsers.recordKnownUser({
      openid: "user-1",
      type: "c2c",
      accountId: "bot-1",
      nickname: "Tester",
    });
    knownUsers.flushKnownUsers();

    sessionStore.saveSession({
      accountId: "bot-1",
      sessionId: "sess-1",
      lastSeq: 42,
      lastConnectedAt: Date.now(),
      intentLevelIndex: 0,
      savedAt: Date.now(),
    });

    const knownUsersFile = path.join(
      stateRoot,
      "qqbot",
      "data",
      "known-users.json",
    );
    const sessionFile = path.join(
      stateRoot,
      "qqbot",
      "sessions",
      "session-bot-1.json",
    );

    expect(fs.existsSync(knownUsersFile)).toBe(true);
    expect(fs.existsSync(sessionFile)).toBe(true);
    expect(sessionStore.loadSession("bot-1")?.sessionId).toBe("sess-1");
  });
});
