import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "openclaw/plugin-sdk/zod";

const QQBotAccountConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  name: z.string().optional(),
  appId: z.string().optional(),
  clientSecret: buildSecretInputSchema().optional(),
  clientSecretFile: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("open"),
  allowFrom: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  imageServerBaseUrl: z.string().optional(),
  markdownSupport: z.boolean().optional().default(true),
});

export const QQBotConfigSchema = QQBotAccountConfigSchema.extend({
  defaultAccount: z.string().optional(),
  accounts: z.record(z.string(), QQBotAccountConfigSchema.optional()).optional(),
}).superRefine((value, ctx) => {
  const defaultAccount = value.defaultAccount?.trim();
  if (!defaultAccount || !value.accounts || Object.keys(value.accounts).length === 0) {
    return;
  }

  const normalizedDefaultAccount = normalizeAccountId(defaultAccount);
  if (!Object.prototype.hasOwnProperty.call(value.accounts, normalizedDefaultAccount)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultAccount"],
      message:
        `channels.qqbot.defaultAccount="${defaultAccount}" does not match a configured account key`,
    });
  }
});

export const QQBotChannelConfigSchema = buildChannelConfigSchema(QQBotConfigSchema);

export type QQBotConfig = z.infer<typeof QQBotConfigSchema>;
