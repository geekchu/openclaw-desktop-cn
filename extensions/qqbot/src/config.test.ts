import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveDefaultQQBotAccountId, resolveQQBotAccount } from "./config.js";

const tempDirs: string[] = [];

function createSecretFile(secret: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-qqbot-secret-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "client-secret.txt");
  fs.writeFileSync(filePath, `${secret}\n`, "utf8");
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.QQBOT_APP_ID;
  delete process.env.QQBOT_CLIENT_SECRET;
});

describe("resolveQQBotAccount", () => {
  it("reads top-level clientSecretFile credentials", () => {
    const cfg = {
      channels: {
        qqbot: {
          appId: "app-from-config",
          clientSecretFile: createSecretFile("file-secret"),
        },
      },
    } as OpenClawConfig;

    const account = resolveQQBotAccount(cfg, "default");

    expect(account.appId).toBe("app-from-config");
    expect(account.clientSecret).toBe("file-secret");
    expect(account.secretSource).toBe("file");
  });

  it("reads named-account clientSecretFile credentials", () => {
    const cfg = {
      channels: {
        qqbot: {
          accounts: {
            work: {
              appId: "named-app",
              clientSecretFile: createSecretFile("named-file-secret"),
            },
          },
        },
      },
    } as OpenClawConfig;

    const account = resolveQQBotAccount(cfg, "work");

    expect(account.appId).toBe("named-app");
    expect(account.clientSecret).toBe("named-file-secret");
    expect(account.secretSource).toBe("file");
  });

  it("still falls back to environment variables for the default account", () => {
    process.env.QQBOT_APP_ID = "env-app-id";
    process.env.QQBOT_CLIENT_SECRET = "env-client-secret";

    const account = resolveQQBotAccount({ channels: { qqbot: {} } } as OpenClawConfig, "default");

    expect(account.appId).toBe("env-app-id");
    expect(account.clientSecret).toBe("env-client-secret");
    expect(account.secretSource).toBe("env");
  });

  it("prefers a configured named account over a partial top-level draft", () => {
    const cfg = {
      channels: {
        qqbot: {
          appId: "draft-top-level",
          accounts: {
            ops: {
              appId: "ops-app",
              clientSecretFile: createSecretFile("ops-secret"),
            },
          },
        },
      },
    } as OpenClawConfig;

    expect(resolveDefaultQQBotAccountId(cfg)).toBe("ops");
  });
});
