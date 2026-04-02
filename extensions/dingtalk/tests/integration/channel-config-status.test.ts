import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", () => ({
  buildChannelConfigSchema: vi.fn((schema: unknown) => schema),
}));

vi.mock("dingtalk-stream", () => ({
  DWClient: vi.fn(),
  TOPIC_ROBOT: "TOPIC_ROBOT",
}));

import { dingtalkPlugin } from "../../src/channel.js";

describe("channel config + status helpers", () => {
  it("resolves account list and account metadata", () => {
    const cfg = {
      channels: {
        dingtalk: {
          accounts: {
            main: { clientId: "id1", clientSecret: "sec1", enabled: true, name: "Main" },
            backup: { clientId: "id2", clientSecret: "sec2", enabled: false },
          },
        },
      },
    } as any;

    const ids = (dingtalkPlugin as any).config.listAccountIds(cfg);
    const account = (dingtalkPlugin as any).config.resolveAccount(cfg, "main");

    expect(ids).toEqual(["main", "backup"]);
    expect(account.accountId).toBe("main");
    expect(account.configured).toBe(true);
    expect((dingtalkPlugin as any).config.describeAccount(account).name).toBe("Main");
  });

  it("includes the default account in mixed top-level plus named-account setups", () => {
    const cfg = {
      channels: {
        dingtalk: {
          clientId: "top-id",
          clientSecret: "top-secret",
          accounts: {
            main: { clientId: "id1", clientSecret: "sec1", enabled: true, name: "Main" },
          },
        },
      },
    } as any;

    const ids = (dingtalkPlugin as any).config.listAccountIds(cfg);
    const defaultAccount = (dingtalkPlugin as any).config.resolveAccount(cfg);

    expect(ids).toEqual(["default", "main"]);
    expect(defaultAccount.accountId).toBe("default");
    expect(defaultAccount.config.clientId).toBe("top-id");
  });

  it("keeps describeAccount configured state aligned with clientSecret requirements", () => {
    const cfg = {
      channels: {
        dingtalk: {
          accounts: {
            partial: { clientId: "id-only", enabled: true, name: "Partial" },
          },
        },
      },
    } as any;

    const account = (dingtalkPlugin as any).config.resolveAccount(cfg, "partial");
    const snapshot = (dingtalkPlugin as any).config.describeAccount(account);

    expect(account.configured).toBe(false);
    expect(snapshot.configured).toBe(false);
  });

  it("prefers a configured named account as the default when top-level credentials are incomplete", () => {
    const cfg = {
      channels: {
        dingtalk: {
          clientId: "partial-top-level",
          accounts: {
            main: { clientId: "id1", clientSecret: "sec1", enabled: true, name: "Main" },
          },
        },
      },
    } as any;

    expect((dingtalkPlugin as any).config.defaultAccountId(cfg)).toBe("main");
    expect((dingtalkPlugin as any).config.resolveAccount(cfg).accountId).toBe("main");
    expect((dingtalkPlugin as any).groups.resolveRequireMention({ cfg })).toBe(true);
  });

  it("does not fall back to the top-level account for an explicit unknown account id", () => {
    const cfg = {
      channels: {
        dingtalk: {
          clientId: "top-id",
          clientSecret: "top-secret",
          accounts: {
            main: { clientId: "id1", clientSecret: "sec1", enabled: true, name: "Main" },
          },
        },
      },
    } as any;

    const account = (dingtalkPlugin as any).config.resolveAccount(cfg, "missing");

    expect(account.accountId).toBe("missing");
    expect(account.config.clientId).toBe("");
    expect(account.config.clientSecret).toBe("");
    expect(account.configured).toBe(false);
  });

  it("validates outbound resolveTarget and messaging/security helpers", () => {
    const resolved = (dingtalkPlugin as any).outbound.resolveTarget({ to: "group:cidAbC" } as any);
    const invalid = (dingtalkPlugin as any).outbound.resolveTarget({ to: "   " } as any);

    expect(resolved).toEqual({ ok: true, to: "cidAbC" });
    expect(invalid.ok).toBe(false);
    expect((dingtalkPlugin as any).messaging.normalizeTarget("dingtalk:user_1")).toBe("user_1");

    const dmPolicy = (dingtalkPlugin as any).security.resolveDmPolicy({
      cfg: {
        channels: {
          dingtalk: {
            accounts: {
              main: {
                dmPolicy: "allowlist",
                allowFrom: ["user_1"],
              },
            },
          },
        },
      },
      accountId: "main",
      account: { config: { dmPolicy: "allowlist", allowFrom: ["user_1"] } },
    } as any);
    expect(dmPolicy.policy).toBe("allowlist");
    expect(dmPolicy.policyPath).toBe("channels.dingtalk.accounts.main.dmPolicy");
    expect(dmPolicy.allowFromPath).toBe("channels.dingtalk.accounts.main.allowFrom");
    expect(dmPolicy.normalizeEntry("dd:User1")).toBe("User1");
  });

  it("builds status summary and issues from account snapshot", () => {
    const issues = (dingtalkPlugin as any).status.collectStatusIssues([
      { accountId: "a1", configured: false },
      { accountId: "a2", configured: true },
    ] as any);

    const summary = (dingtalkPlugin as any).status.buildChannelSummary({
      snapshot: { configured: true, running: false, lastError: "err" },
    } as any);

    const snap = (dingtalkPlugin as any).status.buildAccountSnapshot({
      account: {
        accountId: "a1",
        name: "A1",
        enabled: true,
        configured: true,
        config: { clientId: "id1" },
      },
      runtime: { running: true, lastStartAt: 1, lastStopAt: null, lastError: null },
      snapshot: {},
      probe: { ok: true },
    } as any);

    expect(issues).toHaveLength(1);
    expect(summary.lastError).toBe("err");
    expect(snap.running).toBe(true);
    expect(snap.clientId).toBe("id1");
  });
});
