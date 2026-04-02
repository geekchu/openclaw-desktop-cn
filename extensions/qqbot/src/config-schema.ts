import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";

const QQBotAccountConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  name: z.string().optional(),
  appId: z.string().optional(),
  clientSecret: z.string().optional(),
  clientSecretFile: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("open"),
  allowFrom: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  imageServerBaseUrl: z.string().optional(),
  markdownSupport: z.boolean().optional().default(true),
});

export const QQBotConfigSchema = QQBotAccountConfigSchema.extend({
  accounts: z.record(z.string(), QQBotAccountConfigSchema.optional()).optional(),
});

export const QQBotChannelConfigSchema = buildChannelConfigSchema(QQBotConfigSchema);

export type QQBotConfig = z.infer<typeof QQBotConfigSchema>;
