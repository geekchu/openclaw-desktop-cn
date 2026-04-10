import fs from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { normalizeOptionalAccountId } from "openclaw/plugin-sdk/account-id";
import {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "openclaw/plugin-sdk/secret-input";
import type { ResolvedQQBotAccount, QQBotAccountConfig } from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

interface QQBotChannelConfig extends QQBotAccountConfig {
  defaultAccount?: string;
  accounts?: Record<string, QQBotAccountConfig>;
}

function readQQBotSecretFile(filePath: string | undefined): string {
  const normalized = filePath?.trim();
  if (!normalized) {
    return "";
  }
  try {
    return fs.readFileSync(normalized, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 列出所有 QQBot 账户 ID
 */
export function listQQBotAccountIds(cfg: OpenClawConfig): string[] {
  const ids = new Set<string>();
  const qqbot = cfg.channels?.qqbot as QQBotChannelConfig | undefined;

  if (qqbot?.appId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  if (qqbot?.accounts) {
    for (const accountId of Object.keys(qqbot.accounts)) {
      if (qqbot.accounts[accountId]?.appId) {
        ids.add(accountId);
      }
    }
  }

  return Array.from(ids);
}

/**
 * 获取默认账户 ID
 */
export function resolveDefaultQQBotAccountId(cfg: OpenClawConfig): string {
  const qqbot = cfg.channels?.qqbot as QQBotChannelConfig | undefined;
  const preferredAccountId = normalizeOptionalAccountId(qqbot?.defaultAccount);
  if (preferredAccountId) {
    const accountIds = new Set(
      listQQBotAccountIds(cfg).map((accountId) => normalizeOptionalAccountId(accountId) ?? accountId),
    );
    if (accountIds.has(preferredAccountId)) {
      return preferredAccountId;
    }
  }

  // Prefer a fully configured top-level account. A partial top-level draft
  // should not hide a working named account from status/diagnostic flows.
  if (
    qqbot?.appId &&
    (hasConfiguredSecretInput(qqbot.clientSecret) ||
      Boolean(qqbot.clientSecretFile?.trim()) ||
      Boolean(process.env.QQBOT_CLIENT_SECRET?.trim()))
  ) {
    return DEFAULT_ACCOUNT_ID;
  }
  const configuredNamedAccountId = Object.entries(qqbot?.accounts ?? {}).find(
    ([, account]) =>
      Boolean(
        account?.appId &&
        (hasConfiguredSecretInput(account.clientSecret) || Boolean(account.clientSecretFile?.trim())),
      ),
  )?.[0];
  if (configuredNamedAccountId) {
    return configuredNamedAccountId;
  }
  if (qqbot?.appId) {
    return DEFAULT_ACCOUNT_ID;
  }
  // 否则返回第一个账户
  const firstAccountId = Object.keys(qqbot?.accounts ?? {})[0];
  if (firstAccountId) {
    return firstAccountId;
  }
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 解析 QQBot 账户配置
 */
export function resolveQQBotAccount(
  cfg: OpenClawConfig,
  accountId?: string | null,
  options?: {
    allowUnresolvedSecretRef?: boolean;
  },
): ResolvedQQBotAccount {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
  const qqbot = cfg.channels?.qqbot as QQBotChannelConfig | undefined;

  // 基础配置
  let accountConfig: QQBotAccountConfig = {};
  let appId = "";
  let clientSecret = "";
  let secretSource: "config" | "file" | "env" | "none" = "none";

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    // 默认账户从顶层读取
    accountConfig = {
      enabled: qqbot?.enabled,
      name: qqbot?.name,
      appId: qqbot?.appId,
      clientSecret: qqbot?.clientSecret,
      clientSecretFile: qqbot?.clientSecretFile,
      dmPolicy: qqbot?.dmPolicy,
      allowFrom: qqbot?.allowFrom,
      systemPrompt: qqbot?.systemPrompt,
      imageServerBaseUrl: qqbot?.imageServerBaseUrl,
      markdownSupport: qqbot?.markdownSupport ?? true,
    };
    appId = qqbot?.appId ?? "";
  } else {
    // 命名账户从 accounts 读取
    const account = qqbot?.accounts?.[resolvedAccountId];
    accountConfig = account ?? {};
    appId = account?.appId ?? "";
  }

  // 解析 clientSecret
  const clientSecretPath =
    resolvedAccountId === DEFAULT_ACCOUNT_ID
      ? "channels.qqbot.clientSecret"
      : `channels.qqbot.accounts.${resolvedAccountId}.clientSecret`;
  const inlineClientSecret = normalizeSecretInputString(accountConfig.clientSecret);
  if (inlineClientSecret) {
    clientSecret = inlineClientSecret;
    secretSource = "config";
  } else if (hasConfiguredSecretInput(accountConfig.clientSecret)) {
    clientSecret = options?.allowUnresolvedSecretRef
      ? ""
      : (normalizeResolvedSecretInputString({
          value: accountConfig.clientSecret,
          path: clientSecretPath,
        }) ?? "");
    secretSource = "config";
  } else if (accountConfig.clientSecretFile) {
    clientSecret = readQQBotSecretFile(accountConfig.clientSecretFile);
    secretSource = "file";
  } else if (process.env.QQBOT_CLIENT_SECRET && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    clientSecret = process.env.QQBOT_CLIENT_SECRET;
    secretSource = "env";
  }

  // AppId 也可以从环境变量读取
  if (!appId && process.env.QQBOT_APP_ID && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    appId = process.env.QQBOT_APP_ID;
  }

  return {
    accountId: resolvedAccountId,
    name: accountConfig.name,
    enabled: accountConfig.enabled !== false,
    appId,
    clientSecret,
    secretSource,
    systemPrompt: accountConfig.systemPrompt,
    imageServerBaseUrl: accountConfig.imageServerBaseUrl || process.env.QQBOT_IMAGE_SERVER_BASE_URL,
    markdownSupport: accountConfig.markdownSupport !== false,
    config: accountConfig,
  };
}

/**
 * 应用账户配置
 */
export function applyQQBotAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: {
    appId?: string;
    clientSecret?: string;
    clientSecretFile?: string;
    name?: string;
    imageServerBaseUrl?: string;
  },
): OpenClawConfig {
  const next = { ...cfg };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    // 如果没有设置过 allowFrom，默认设置为 ["*"]
    const existingConfig = (next.channels?.qqbot as QQBotChannelConfig) || {};
    const allowFrom = existingConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      qqbot: {
        ...((next.channels?.qqbot as Record<string, unknown>) || {}),
        enabled: true,
        allowFrom,
        ...(input.appId ? { appId: input.appId } : {}),
        ...(input.clientSecret
          ? { clientSecret: input.clientSecret }
          : input.clientSecretFile
            ? { clientSecretFile: input.clientSecretFile }
            : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.imageServerBaseUrl ? { imageServerBaseUrl: input.imageServerBaseUrl } : {}),
      },
    };
  } else {
    // 如果没有设置过 allowFrom，默认设置为 ["*"]
    const existingAccountConfig =
      (next.channels?.qqbot as QQBotChannelConfig)?.accounts?.[accountId] || {};
    const allowFrom = existingAccountConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      qqbot: {
        ...((next.channels?.qqbot as Record<string, unknown>) || {}),
        enabled: true,
        accounts: {
          ...(next.channels?.qqbot as QQBotChannelConfig)?.accounts,
          [accountId]: {
            ...(next.channels?.qqbot as QQBotChannelConfig)?.accounts?.[accountId],
            enabled: true,
            allowFrom,
            ...(input.appId ? { appId: input.appId } : {}),
            ...(input.clientSecret
              ? { clientSecret: input.clientSecret }
              : input.clientSecretFile
                ? { clientSecretFile: input.clientSecretFile }
                : {}),
            ...(input.name ? { name: input.name } : {}),
            ...(input.imageServerBaseUrl ? { imageServerBaseUrl: input.imageServerBaseUrl } : {}),
          },
        },
      },
    };
  }

  return next;
}
