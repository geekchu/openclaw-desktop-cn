import { LitElement, html, css, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

/* ── tiny Tauri invoke helper ─────────────────────────────── */
const tauri = (
  window as unknown as {
    __TAURI__?: {
      core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
  }
).__TAURI__;
async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (tauri?.core?.invoke) {
    return tauri.core.invoke(cmd, args) as Promise<T>;
  }
  throw new Error("Tauri invoke not available");
}

interface ChannelConfig {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface ChannelField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

const channelIcons = {
  telegram: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  `,
  discord: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  `,
  slack: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="3" height="8" x="13" y="2" rx="1.5" />
      <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5" />
      <rect width="3" height="8" x="8" y="14" rx="1.5" />
      <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5" />
      <rect width="8" height="3" x="14" y="13" rx="1.5" />
      <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5" />
      <rect width="8" height="3" x="2" y="8" rx="1.5" />
      <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5" />
    </svg>
  `,
  feishu: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </svg>
  `,
  imessage: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"
      />
      <path d="M10 2c1 .5 2 2 2 5" />
    </svg>
  `,
  whatsapp: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
    </svg>
  `,

  wecom: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  `,
  dingtalk: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  `,
  qqbot: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <circle cx="9" cy="10" r="1.25" />
      <circle cx="15" cy="10" r="1.25" />
    </svg>
  `,
  default: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `,
};

const _iconChevronRight = html`
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
`;
const iconCheck = html`
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
`;
const iconCheckCircle = html`
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
`;
const iconXCircle = html`
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m15 9-6 6" />
    <path d="m9 9 6 6" />
  </svg>
`;
const iconQrCode = html`
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect width="5" height="5" x="3" y="3" rx="1" />
    <rect width="5" height="5" x="16" y="3" rx="1" />
    <rect width="5" height="5" x="3" y="16" rx="1" />
    <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
    <path d="M21 21v.01" />
    <path d="M12 7v3a2 2 0 0 1-2 2H7" />
    <path d="M3 12h.01" />
    <path d="M12 3h.01" />
    <path d="M12 16v.01" />
    <path d="M16 12h1" />
    <path d="M21 12v.01" />
    <path d="M12 21v-1" />
  </svg>
`;
const iconPlay = html`
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
`;
const iconTrash2 = html`
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
`;
const iconLoader2 = html`
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="animate-spin"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
`;
const iconRefresh = html`
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
`;
const iconUserCheck = html`
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <polyline points="16 11 18 13 22 9" />
  </svg>
`;

interface PairingRequest {
  code: string;
  id?: string;
  createdAt?: string;
  meta?: Record<string, string>;
}

const channelInfo: Record<
  string,
  {
    name: string;
    icon: unknown;
    theme: string;
    fields: ChannelField[];
    helpText?: string;
  }
> = {
  telegram: {
    name: "Telegram",
    icon: channelIcons.telegram,
    theme: "blue",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "从 @BotFather 获取",
        required: true,
      },
      {
        key: "userId",
        label: "User ID",
        type: "text",
        placeholder: "你的 Telegram User ID",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: 1234567, 7654321",
      },
      {
        key: "groupAllowFrom",
        label: "群组白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: -1001234, -1005678",
      },
    ],
    helpText: "推荐搜索 @BotFather 发送 /newbot 获取 Token",
  },
  discord: {
    name: "Discord",
    icon: channelIcons.discord,
    theme: "blue",
    fields: [
      {
        key: "token",
        label: "Bot Token",
        type: "password",
        placeholder: "Discord Bot Token",
        required: true,
      },
      {
        key: "testChannelId",
        label: "测试 Channel ID",
        type: "text",
        placeholder: "用于发送测试消息的频道 ID (可选)",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: 123456789",
      },
    ],
    helpText: "从 Discord Developer Portal 获取",
  },
  slack: {
    name: "Slack",
    icon: channelIcons.slack,
    theme: "purple",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "xoxb-...",
        required: true,
      },
      {
        key: "mode",
        label: "连接模式",
        type: "select",
        options: [
          { value: "socket", label: "Socket Mode（默认）" },
          { value: "http", label: "HTTP Events API" },
        ],
      },
      {
        key: "appToken",
        label: "App Token",
        type: "password",
        placeholder: "xapp-...（Socket Mode 必填）",
      },
      {
        key: "signingSecret",
        label: "Signing Secret",
        type: "password",
        placeholder: "HTTP 模式必填",
      },
      { key: "testChannelId", label: "测试 Channel ID", type: "text", placeholder: "可选" },
      {
        key: "requireMention",
        label: "需要 @提及",
        type: "select",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群聊策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: U1234567, U7654321",
      },
      {
        key: "groupAllowFrom",
        label: "群聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: C1234567, C7654321",
      },
    ],
    helpText: "从 Slack API 后台获取",
  },
  feishu: {
    name: "飞书",
    icon: channelIcons.feishu,
    theme: "blue",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "飞书应用 App ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "飞书应用 App Secret",
        required: true,
      },
      {
        key: "encryptKey",
        label: "Encrypt Key",
        type: "password",
        placeholder: "用于 Webhook 模式的消息加密密钥 (可选)",
      },
      {
        key: "verificationToken",
        label: "Verification Token",
        type: "password",
        placeholder: "用于 Webhook 模式的事件订阅验证令牌 (可选)",
      },
      {
        key: "connectionMode",
        label: "连接模式",
        type: "select",
        options: [
          { value: "websocket", label: "WebSocket (推荐)" },
          { value: "webhook", label: "Webhook" },
        ],
      },
      {
        key: "domain",
        label: "部署区域",
        type: "select",
        options: [
          { value: "feishu", label: "国内 (feishu.cn)" },
          { value: "lark", label: "海外 (larksuite.com)" },
        ],
      },
      {
        key: "requireMention",
        label: "需要 @提及",
        type: "select",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: ou_123456789",
      },
      {
        key: "groupAllowFrom",
        label: "群聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: oc_123456789",
      },
    ],
    helpText: "需要安装并启用开放平台的机器人能力",
  },
  imessage: {
    name: "iMessage",
    icon: channelIcons.imessage,
    theme: "green",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: +1234567890",
      },
      {
        key: "groupAllowFrom",
        label: "群聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "群组 ID",
      },
      {
        key: "dbPath",
        label: "chat.db 路径",
        type: "text",
        placeholder: "可选 (如果由于权限问题失败可以填文件拷贝路径)",
      },
    ],
    helpText: "仅支持 macOS",
  },
  whatsapp: {
    name: "WhatsApp",
    icon: channelIcons.whatsapp,
    theme: "green",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: 8613800000000@s.whatsapp.net",
      },
      {
        key: "groupAllowFrom",
        label: "群聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: 12345678-9012@g.us",
      },
    ],
    helpText: "登录成功后支持发送和接收",
  },

  wecom: {
    name: "企业微信",
    icon: channelIcons.wecom,
    theme: "green",
    fields: [
      {
        key: "token",
        label: "Token",
        type: "password",
        placeholder: "企业微信 AI Bot 回调 Token",
        required: true,
      },
      {
        key: "encodingAesKey",
        label: "EncodingAESKey",
        type: "password",
        placeholder: "企业微信消息加密密钥 (43位)",
        required: true,
      },
    ],
    helpText: "企业微信 AI Bot，使用回调模式接收消息",
  },
  dingtalk: {
    name: "钉钉",
    icon: channelIcons.dingtalk,
    theme: "blue",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        type: "text",
        placeholder: "钉钉应用 AppKey (Client ID)",
        required: true,
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "password",
        placeholder: "钉钉应用 AppSecret (Client Secret)",
        required: true,
      },
      { key: "robotCode", label: "机器人编码", type: "text", placeholder: "可选，用于媒体下载" },
      { key: "corpId", label: "企业 ID", type: "text", placeholder: "可选，企业 Corp ID" },
      {
        key: "messageType",
        label: "消息类型",
        type: "select",
        options: [
          { value: "markdown", label: "Markdown" },
          { value: "card", label: "AI 卡片" },
        ],
      },
      {
        key: "agentId",
        label: "Agent ID",
        type: "text",
        placeholder: "可选，微应用 AgentId",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "open", label: "开放" },
          { value: "pairing", label: "配对" },
          { value: "allowlist", label: "白名单" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群聊策略",
        type: "select",
        options: [
          { value: "open", label: "开放" },
          { value: "allowlist", label: "白名单" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: user123, manager456",
      },
    ],
    helpText: "钉钉企业内部机器人，使用 Stream 模式，无需公网 IP",
  },
  qqbot: {
    name: "QQ",
    icon: channelIcons.qqbot,
    theme: "blue",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "QQ 开放平台 AppID",
        required: true,
      },
      {
        key: "clientSecret",
        label: "App Secret",
        type: "password",
        placeholder: "QQ 开放平台 AppSecret",
        required: true,
      },
      {
        key: "markdownSupport",
        label: "Markdown 消息",
        type: "select",
        options: [
          { value: "false", label: "关闭" },
          { value: "true", label: "开启 (需要平台权限)" },
        ],
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "open", label: "开放" },
          { value: "pairing", label: "配对" },
          { value: "allowlist", label: "白名单" },
        ],
      },
      {
        key: "allowFrom",
        label: "私聊/群组白名单 (逗号分隔)",
        type: "text",
        placeholder: "如: 12345678",
      },
    ],
    helpText: "QQ 官方机器人，使用 WebSocket 连接，无需公网 IP",
  },
  default: {
    name: "未知平台",
    icon: channelIcons.default,
    theme: "gray",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText: "未知的通讯平台配置",
  },
};

interface TestResult {
  success: boolean;
  message: string;
  error: string | null;
}

@customElement("openclaw-config-channels")
export class OpenClawConfigChannels extends LitElement {
  /* ───────────────────────────────────────────────
     CSS — matches the native App Visual Setup
     ─────────────────────────────────────────────── */
  static override styles = css`
    :host {
      display: flex;
      flex-direction: row;
      height: 100%;
      color: var(--text, #e4e4e7);
      background: var(--bg, #09090b);
      font-family: var(--font-body, "Space Grotesk", system-ui, sans-serif);
      overflow: hidden;
    }

    /* ── layout ── */
    .sidebar {
      width: 280px;
      border-right: 1px solid var(--border, #27272a);
      overflow-y: auto;
      background: var(--bg-elevated, #1a1d25);
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      /* Remove forced background so it uses host's background */
    }
    .content-inner {
      max-width: 680px;
      margin: 0 auto;
      padding: 0;
    }

    /* ── sidebar items ── */
    .sidebar-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border, #27272a);
    }
    .sidebar-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--muted, #71717a);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .channel-list {
      display: flex;
      flex-direction: column;
      padding: 12px;
      gap: 4px;
    }
    .channel-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: 12px;
      cursor: pointer;
      background: transparent;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      text-align: left;
    }
    .channel-item:hover {
      background: var(--bg-hover, #262a35);
    }
    .channel-item.active {
      background: var(--bg-hover, #262a35);
      border-color: var(--border, #27272a);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .channel-item-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--card, #181b22);
      border: 1px solid var(--border, #27272a);
      flex-shrink: 0;
    }
    .channel-item-icon svg {
      width: 16px;
      height: 16px;
    }
    .channel-item.active .channel-item-icon {
      background: var(--card, #181b22);
    }
    .channel-item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .channel-item-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-strong, #fafafa);
    }
    .channel-item-status {
      font-size: 12px;
      margin-top: 2px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .status-ok {
      color: var(--success, #22c55e);
    }
    .status-none {
      color: var(--muted, #71717a);
    }

    /* ── card / content (matches system settings styling) ── */
    .card {
      background: var(--bg-elevated, #1a1d25);
      border: 1px solid var(--border, #27272a);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
      animation: fadeIn 0.15s ease-out;
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border, #27272a);
    }
    .card-title-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .card-title-icon.amber {
      background: rgba(245, 158, 11, 0.15);
      color: var(--warn, #f59e0b);
    }
    .card-title-icon.blue {
      background: rgba(59, 130, 246, 0.15);
      color: var(--info, #3b82f6);
    }
    .card-title-icon.green {
      background: rgba(34, 197, 94, 0.15);
      color: var(--success, #22c55e);
    }
    .card-title-icon.purple {
      background: rgba(168, 85, 247, 0.15);
      color: var(--purple-400, #c084fc);
    }
    .card-title-icon svg {
      width: 22px;
      height: 22px;
    }
    .title-text {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-strong, #fafafa);
    }
    .title-sub {
      font-size: 13px;
      color: var(--muted, #71717a);
      margin-top: 4px;
    }

    /* ── form fields ── */
    .field {
      margin-bottom: 20px;
    }
    .field-label {
      display: flex;
      align-items: center;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted, #71717a);
      margin-bottom: 8px;
      gap: 6px;
    }
    .label-req {
      color: var(--accent, #ff5c5c);
    }
    .label-ok {
      color: var(--success, #22c55e);
    }

    .input-base {
      width: 100%;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1px solid var(--border, #27272a);
      background: var(--bg-elevated, #1a1d25);
      color: var(--text, #e4e4e7);
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
      font-family: inherit;
    }
    .input-base::placeholder {
      color: var(--muted, #71717a);
    }
    .input-base:focus {
      border-color: var(--accent, #ff5c5c);
      box-shadow:
        0 0 0 2px var(--panel, #12141a),
        0 0 0 4px var(--ring, #ff5c5c);
    }
    select.input-base {
      appearance: none;
      cursor: pointer;
    }

    .input-wrapper {
      position: relative;
    }
    .input-icon-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted, #71717a);
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    .input-icon-btn:hover {
      color: var(--text, #e4e4e7);
    }

    /* ── specific blocks ── */
    .notice {
      padding: 16px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.2);
      margin-bottom: 20px;
      display: flex;
      gap: 12px;
    }
    .notice.info {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.2);
    }
    .notice.success {
      background: rgba(34, 197, 94, 0.1);
      border-color: rgba(34, 197, 94, 0.2);
    }
    .notice-icon {
      flex-shrink: 0;
      padding-top: 2px;
    }
    .notice.info .notice-icon svg {
      color: var(--info, #3b82f6);
    }
    .notice.success .notice-icon svg {
      color: var(--success, #22c55e);
    }
    .notice.warn .notice-icon svg {
      color: var(--warn, #f59e0b);
    }
    .notice-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-strong, #fafafa);
      margin-bottom: 4px;
    }
    .notice-desc {
      font-size: 12px;
      color: var(--muted, #71717a);
      line-height: 1.5;
    }

    /* ── actions ── */
    .actions-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid var(--border, #27272a);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      height: 38px;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: var(--text-strong, #ffffff);
      color: var(--bg, #000000);
    }
    .btn-primary:not(:disabled):hover {
      background: #e4e4e7;
    }

    .btn-secondary {
      background: var(--bg-hover, #262a35);
      color: var(--text, #e4e4e7);
      border-color: var(--border, #27272a);
    }
    .btn-secondary:not(:disabled):hover {
      background: var(--border, #27272a);
    }

    .btn-danger {
      background: transparent;
      color: var(--accent, #ff5c5c);
      border-color: transparent;
    }
    .btn-danger:not(:disabled):hover {
      background: rgba(255, 92, 92, 0.1);
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
      height: 32px;
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(5px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .test-result {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      display: flex;
      gap: 12px;
      animation: fadeIn 0.2s;
    }
    .test-result.ok {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
    }
    .test-result.err {
      background: rgba(255, 92, 92, 0.1);
      border: 1px solid rgba(255, 92, 92, 0.2);
    }
    .test-result-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .test-result.ok .test-result-title {
      color: var(--success, #22c55e);
    }
    .test-result.err .test-result-title {
      color: var(--accent, #ff5c5c);
    }
    .test-result-desc {
      font-size: 13px;
      color: var(--text, #e4e4e7);
      word-break: break-all;
      margin-top: 4px;
    }
    .test-result-err {
      font-size: 12px;
      color: var(--accent, #ff5c5c);
      font-family: monospace;
      white-space: pre-wrap;
      margin-top: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
    .empty-state {
      text-align: center;
      color: var(--muted, #71717a);
      padding: 60px 20px;
    }

    /* ── pairing section ── */
    .pairing-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pairing-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--bg, #09090b);
      border: 1px solid var(--border, #27272a);
    }
    .pairing-code {
      font-family: monospace;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-strong, #fafafa);
      letter-spacing: 0.05em;
    }
    .pairing-meta {
      flex: 1;
      font-size: 12px;
      color: var(--muted, #71717a);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pairing-empty {
      text-align: center;
      color: var(--muted, #71717a);
      font-size: 13px;
      padding: 20px 0;
    }
    .pairing-input-row {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
    .pairing-input-row input {
      flex: 1;
    }
  `;

  @state() private channels: ChannelConfig[] = [];
  @state() private loading = true;
  @state() private selectedChannel: string | null = null;
  @state() private configForm: Record<string, string> = {};
  @state() private saving = false;
  @state() private testing = false;
  @state() private testResult: TestResult | null = null;
  @state() private loginLoading = false;
  @state() private clearing = false;
  @state() private showClearConfirm = false;

  @state() private visiblePasswords = new Set<string>();
  @state() private selectedChannelConfig: Record<string, unknown> = {};

  @state() private pairingRequests: PairingRequest[] = [];
  @state() private pairingLoading = false;
  @state() private approveCode = "";
  @state() private approveLoading = false;
  @state() private approveResult: { success: boolean; message: string } | null = null;

  private _whatsappPollTimer: ReturnType<typeof setInterval> | null = null;
  private _whatsappTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private _pairingPollTimer: ReturnType<typeof setInterval> | null = null;

  override async connectedCallback() {
    super.connectedCallback();
    await this.init();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this._whatsappPollTimer) {
      clearInterval(this._whatsappPollTimer);
      this._whatsappPollTimer = null;
    }
    if (this._whatsappTimeoutTimer) {
      clearTimeout(this._whatsappTimeoutTimer);
      this._whatsappTimeoutTimer = null;
    }
    this._stopPairingPoll();
  }

  private _stopPairingPoll() {
    if (this._pairingPollTimer) {
      clearInterval(this._pairingPollTimer);
      this._pairingPollTimer = null;
    }
  }

  private _startPairingPoll(channelId: string) {
    this._stopPairingPoll();
    this._fetchPairingRequests(channelId);
    this._pairingPollTimer = setInterval(() => {
      this._fetchPairingRequests(channelId);
    }, 30000);
  }

  private async _fetchPairingRequests(channelId: string) {
    this.pairingLoading = true;
    try {
      const result: PairingRequest[] = await invoke("list_pairing_requests", {
        channel: channelId,
      });
      // Guard against stale responses from a previously selected channel
      if (this.selectedChannel !== channelId) {
        return;
      }
      this.pairingRequests = result;
    } catch (e) {
      if (this.selectedChannel !== channelId) {
        return;
      }
      console.error("获取配对请求失败:", e);
      this.pairingRequests = [];
    } finally {
      if (this.selectedChannel === channelId) {
        this.pairingLoading = false;
      }
    }
  }

  private async _handleApproveCode(channelId: string, code: string) {
    if (!code.trim()) {
      return;
    }
    this.approveLoading = true;
    this.approveResult = null;
    try {
      const result: { success: boolean; message: string } = await invoke("approve_pairing_code", {
        channel: channelId,
        code: code.trim(),
      });
      this.approveResult = result;
      if (result.success) {
        this.approveCode = "";
        this._fetchPairingRequests(channelId);
      }
    } catch (e) {
      this.approveResult = { success: false, message: String(e) };
    } finally {
      this.approveLoading = false;
    }
  }

  private async fetchChannels() {
    try {
      const result: ChannelConfig[] = await invoke("get_channels_config");
      const channelOrder: Record<string, number> = {
        wecom: 0,
        dingtalk: 1,
        feishu: 2,
        whatsapp: 3,
        discord: 4,
        slack: 5,
        imessage: 6,
      };
      result.sort(
        (a, b) => (channelOrder[a.channel_type] ?? 99) - (channelOrder[b.channel_type] ?? 99),
      );
      this.channels = result;
      return result;
    } catch (e) {
      console.error("获取渠道配置失败:", e);
      return [];
    }
  }

  private async init() {
    this.loading = true;
    try {
      const result = await this.fetchChannels();
      const configured = result.find((c) => c.enabled);
      if (configured) {
        this.handleChannelSelect(configured.id, result);
      } else if (result.length > 0) {
        this.handleChannelSelect(result[0].id, result);
      }
    } finally {
      this.loading = false;
    }
  }

  private getDefaultDmPolicy(channelType: string): string | null {
    switch (channelType) {
      case "telegram":
      case "discord":
      case "slack":
      case "feishu":
      case "imessage":
      case "whatsapp":
        return "pairing";
      default:
        return null;
    }
  }

  private shouldShowPairing(channelType: string, dmPolicy?: string | null) {
    const effectivePolicy = dmPolicy?.trim() || this.getDefaultDmPolicy(channelType);
    return effectivePolicy === "pairing";
  }

  private parseAllowlist(raw: unknown): string[] {
    if (typeof raw !== "string") {
      return [];
    }
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private validateConfigBeforeSave(channel: ChannelConfig, config: Record<string, unknown>) {
    const info = channelInfo[channel.channel_type];
    const requiredFields = info?.fields.filter((field) => field.required) ?? [];
    for (const field of requiredFields) {
      const value = config[field.key];
      if (value === undefined || value === null || String(value).trim() === "") {
        return `${field.label} is required`;
      }
    }

    const dmPolicy = typeof config.dmPolicy === "string" ? config.dmPolicy.trim() : "";
    const allowFrom = this.parseAllowlist(config.allowFrom);
    if (dmPolicy === "allowlist" && allowFrom.length === 0) {
      return "Allowlist mode requires DM allowlist entries";
    }
    if (
      dmPolicy === "open" &&
      ["telegram", "discord", "slack", "feishu", "imessage", "whatsapp"].includes(
        channel.channel_type,
      ) &&
      !allowFrom.includes("*")
    ) {
      return "Open mode requires * in DM allowlist";
    }

    if (channel.channel_type === "slack") {
      const mode = typeof config.mode === "string" && config.mode.trim() ? config.mode.trim() : "socket";
      if (!config.botToken || String(config.botToken).trim() === "") {
        return "Bot Token is required";
      }
      if (mode === "http") {
        if (!config.signingSecret || String(config.signingSecret).trim() === "") {
          return "HTTP mode requires Signing Secret";
        }
      } else if (!config.appToken || String(config.appToken).trim() === "") {
        return "Socket Mode requires App Token";
      }
    }

    return null;
  }

  private togglePasswordVisibility(fieldKey: string) {
    const next = new Set(this.visiblePasswords);
    if (next.has(fieldKey)) {
      next.delete(fieldKey);
    } else {
      next.add(fieldKey);
    }
    this.visiblePasswords = next;
  }

  private handleShowClearConfirm() {
    if (!this.selectedChannel) {
      return;
    }
    this.showClearConfirm = true;
  }

  private async handleClearConfig() {
    if (!this.selectedChannel) {
      return;
    }

    const channel = this.channels.find((c) => c.id === this.selectedChannel);
    const channelName = channel
      ? channelInfo[channel.channel_type]?.name || channel.channel_type
      : this.selectedChannel;

    this.showClearConfirm = false;
    this.clearing = true;
    try {
      await invoke("clear_channel_config", { channelId: this.selectedChannel });
      this.configForm = {};
      this.selectedChannelConfig = {};
      const refreshedChannels = await this.fetchChannels();
      this.handleChannelSelect(this.selectedChannel, refreshedChannels);
      this.testResult = {
        success: true,
        message: channelName + " 配置已清空",
        error: null,
      };
    } catch (e) {
      this.testResult = {
        success: false,
        message: "清空失败",
        error: String(e),
      };
    } finally {
      this.clearing = false;
    }
  }

  private async handleQuickTest() {
    if (!this.selectedChannel) {
      return;
    }

    this.testing = true;
    this.testResult = null;

    try {
      const result: {
        success: boolean;
        channel: string;
        message: string;
        error: string | null;
      } = await invoke("test_channel", { channelType: this.selectedChannel });

      this.testResult = {
        success: result.success,
        message: result.message,
        error: result.error,
      };
    } catch (e) {
      this.testResult = {
        success: false,
        message: "测试失败",
        error: String(e),
      };
    } finally {
      this.testing = false;
    }
  }

  private async handleWhatsAppLogin() {
    this.loginLoading = true;
    // 清理之前的轮询定时器
    if (this._whatsappPollTimer) {
      clearInterval(this._whatsappPollTimer);
      this._whatsappPollTimer = null;
    }
    if (this._whatsappTimeoutTimer) {
      clearTimeout(this._whatsappTimeoutTimer);
      this._whatsappTimeoutTimer = null;
    }
    try {
      await invoke("start_channel_login", { channelType: "whatsapp" });

      this._whatsappPollTimer = setInterval(async () => {
        try {
          const result: {
            success: boolean;
            message: string;
          } = await invoke("test_channel", { channelType: "whatsapp" });

          if (result.success) {
            if (this._whatsappPollTimer) {
              clearInterval(this._whatsappPollTimer);
              this._whatsappPollTimer = null;
            }
            if (this._whatsappTimeoutTimer) {
              clearTimeout(this._whatsappTimeoutTimer);
              this._whatsappTimeoutTimer = null;
            }
            this.loginLoading = false;
            await this.fetchChannels();
            this.testResult = {
              success: true,
              message: "WhatsApp 登录成功！",
              error: null,
            };
          }
        } catch {
          // 继续轮询
        }
      }, 3000);

      this._whatsappTimeoutTimer = setTimeout(() => {
        if (this._whatsappPollTimer) {
          clearInterval(this._whatsappPollTimer);
          this._whatsappPollTimer = null;
        }
        this._whatsappTimeoutTimer = null;
        this.loginLoading = false;
      }, 60000);

      alert("请在弹出的终端窗口中扫描二维码完成登录\n\n登录成功后界面会自动更新");
    } catch (e) {
      alert("启动登录失败: " + e);
      this.loginLoading = false;
    }
  }

  private handleChannelSelect(channelId: string, channelList?: ChannelConfig[]) {
    this.selectedChannel = channelId;
    this.testResult = null;
    this.approveResult = null;
    this.approveCode = "";
    this.pairingRequests = [];
    this._stopPairingPoll();

    const list = channelList || this.channels;
    const channel = list.find((c) => c.id === channelId);

    if (channel) {
      const form: Record<string, string> = {};
      const info = channelInfo[channel.channel_type];
      const editableKeys = new Set(info?.fields.map((field) => field.key) ?? []);

      info?.fields.forEach((field) => {
        form[field.key] = "";
      });

      this.selectedChannelConfig = { ...(channel.config || {}) };

      for (const key of editableKeys) {
        const value = channel.config?.[key];
        if (typeof value === "boolean") {
          form[key] = value ? "true" : "false";
        } else if (typeof value === "string" || typeof value === "number") {
          form[key] = String(value);
        }
      }

      this.configForm = form;

      if (this.shouldShowPairing(channel.channel_type, form.dmPolicy)) {
        this._startPairingPoll(channelId);
      }
    } else {
      this.selectedChannelConfig = {};
      this.configForm = {};
    }
  }

  private async handleSave() {
    if (!this.selectedChannel) {
      return;
    }

    const channel = this.channels.find((c) => c.id === this.selectedChannel);
    if (!channel) {
      return;
    }

    this.saving = true;
    try {
      const info = channelInfo[channel.channel_type];
      const config: Record<string, unknown> = { ...this.selectedChannelConfig };

      for (const field of info?.fields ?? []) {
        const value = this.configForm[field.key] ?? "";
        if (value === "true") {
          config[field.key] = true;
        } else if (value === "false") {
          config[field.key] = false;
        } else if (value.trim() !== "") {
          config[field.key] = value.trim();
        } else {
          delete config[field.key];
        }
      }

      const validationError = this.validateConfigBeforeSave(channel, config);
      if (validationError) {
        this.testResult = { success: false, message: validationError, error: null };
        return;
      }

      await invoke("save_channel_config", {
        channel: {
          ...channel,
          config,
        },
      });

      const refreshedChannels = await this.fetchChannels();
      this.handleChannelSelect(channel.id, refreshedChannels);
      this.testResult = {
        success: true,
        message: "Saved configuration successfully",
        error: null,
      };
    } catch (e) {
      console.error("Save failed:", e);
      this.testResult = { success: false, message: "Failed to save configuration", error: String(e) };
    } finally {
      this.saving = false;
    }
  }

  private hasValidConfig(channel: ChannelConfig) {
    const info = channelInfo[channel.channel_type];
    if (!info) {
      return channel.enabled;
    }

    const dmPolicy =
      typeof channel.config.dmPolicy === "string" && channel.config.dmPolicy.trim()
        ? channel.config.dmPolicy.trim()
        : this.getDefaultDmPolicy(channel.channel_type);
    const allowFrom = this.parseAllowlist(channel.config.allowFrom);

    if (dmPolicy === "allowlist" && allowFrom.length === 0) {
      return false;
    }
    if (
      dmPolicy === "open" &&
      ["telegram", "discord", "slack", "feishu", "imessage", "whatsapp"].includes(
        channel.channel_type,
      ) &&
      !allowFrom.includes("*")
    ) {
      return false;
    }

    if (channel.channel_type === "telegram") {
      const botToken = channel.config.botToken;
      return botToken !== undefined && botToken !== null && String(botToken).trim() !== "";
    }
    if (channel.channel_type === "slack") {
      const botToken = channel.config.botToken;
      const modeRaw = channel.config.mode;
      const mode = typeof modeRaw === "string" && modeRaw.trim() ? modeRaw.trim() : "socket";
      const appToken = channel.config.appToken;
      const signingSecret = channel.config.signingSecret;
      const hasBotToken = botToken !== undefined && botToken !== null && String(botToken).trim() !== "";
      if (!hasBotToken) {
        return false;
      }
      if (mode === "http") {
        return (
          signingSecret !== undefined &&
          signingSecret !== null &&
          String(signingSecret).trim() !== ""
        );
      }
      return appToken !== undefined && appToken !== null && String(appToken).trim() !== "";
    }

    const requiredFields = info.fields.filter((field) => field.required);
    if (requiredFields.length === 0) {
      return channel.enabled;
    }
    return requiredFields.every((field) => {
      const value = channel.config[field.key];
      return value !== undefined && value !== null && String(value).trim() !== "";
    });
  }

  private handleTextInput(e: Event, key: string) {
    const v = (e.target as HTMLInputElement).value;
    this.configForm = { ...this.configForm, [key]: v };
  }

  private handleSelectChange(e: Event, key: string) {
    const v = (e.target as HTMLSelectElement).value;
    this.configForm = { ...this.configForm, [key]: v };

    // dmPolicy 切换时启动/停止配对轮询
    if (key === "dmPolicy" && this.selectedChannel) {
      const channelConfig = this.channels.find((c) => c.id === this.selectedChannel);
      if (channelConfig && this.shouldShowPairing(channelConfig.channel_type, v)) {
        this._startPairingPoll(this.selectedChannel);
      } else {
        this._stopPairingPoll();
        this.pairingRequests = [];
        this.approveResult = null;
      }
    }
  }

  override render() {
    if (this.loading) {
      return html`
        <div class="empty-state" style="margin-top: 200px;">
          ${iconLoader2}
          <div style="margin-top: 12px;">加载中...</div>
        </div>
      `;
    }

    const currentChannel = this.channels.find((c) => c.id === this.selectedChannel);
    const currentInfo = currentChannel
      ? channelInfo[currentChannel.channel_type] || channelInfo.default
      : null;

    return html`
      <!-- Sidebar -->
      <div class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-title">平台列表</div>
        </div>
        <div class="channel-list">
          ${this.channels.map((channel) => {
            const info = channelInfo[channel.channel_type] || channelInfo.default;
            const isSelected = this.selectedChannel === channel.id;
            const isConfigured = this.hasValidConfig(channel);
            return html`
              <button
                class="channel-item ${isSelected ? "active" : ""}"
                @click=${() => this.handleChannelSelect(channel.id)}
              >
                <div class="channel-item-icon">
                  ${info.icon}
                </div>
                <div class="channel-item-info">
                  <div class="channel-item-name">${info.name || channel.channel_type}</div>
                  <div class="channel-item-status ${isConfigured ? "status-ok" : "status-none"}">
                    ${
                      isConfigured
                        ? html`${iconCheck} 已配置`
                        : html`
                            未配置
                          `
                    }
                  </div>
                </div>
              </button>
            `;
          })}
        </div>
      </div>

      <!-- Main Config Panel -->
      <div class="content">
        <div class="content-inner">
          ${
            currentChannel && currentInfo
              ? html`
            <div class="card">
              <div class="card-title">
                <div class="card-title-icon ${currentInfo.theme || "gray"}">
                  ${currentInfo.icon}
                </div>
                <div>
                  <div class="title-text">${currentInfo.name} 配置</div>
                  ${currentInfo.helpText ? html`<div class="title-sub">${currentInfo.helpText}</div>` : nothing}
                </div>
              </div>

              <!-- Config form fields -->
              <div class="fields-container">
                ${currentInfo.fields?.map(
                  (field: ChannelField) => html`
                  <div class="field">
                    <label class="field-label">
                      ${field.label}
                      ${
                        field.required
                          ? html`
                              <span class="label-req">*</span>
                            `
                          : nothing
                      }
                      ${this.configForm[field.key] ? html`<span class="label-ok" style="margin-left: auto;">${iconCheck}</span>` : nothing}
                    </label>
                    
                    ${
                      field.type === "select"
                        ? html`
                      <select
                        @change=${(e: Event) => this.handleSelectChange(e, field.key)}
                        class="input-base"
                      >
                        <option value="" ?selected=${!this.configForm[field.key]}>请选择...</option>
                        ${field.options?.map((opt) => html`<option value="${opt.value}" ?selected=${this.configForm[field.key] === opt.value}>${opt.label}</option>`)}
                      </select>
                    `
                        : field.type === "password"
                          ? html`
                      <div class="input-wrapper">
                        <input
                          type=${this.visiblePasswords.has(field.key) ? "text" : "password"}
                          .value=${this.configForm[field.key] || ""}
                          @input=${(e: Event) => this.handleTextInput(e, field.key)}
                          placeholder="${field.placeholder || ""}"
                          class="input-base"
                          style="padding-right: 36px;"
                        />
                        <button
                          type="button"
                          @click=${() => this.togglePasswordVisibility(field.key)}
                          class="input-icon-btn"
                          title="${this.visiblePasswords.has(field.key) ? "隐藏" : "显示"}"
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            ${
                              this.visiblePasswords.has(field.key)
                                ? html`
                                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path
                                      d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"
                                    /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line
                                      x1="2"
                                      x2="22"
                                      y1="2"
                                      y2="22"
                                    />
                                  `
                                : html`
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
                                  `
                            }
                          </svg>
                        </button>
                      </div>
                    `
                          : html`
                      <input
                        type="${field.type}"
                        .value=${this.configForm[field.key] || ""}
                        @input=${(e: Event) => this.handleTextInput(e, field.key)}
                        placeholder="${field.placeholder || ""}"
                        class="input-base"
                      />
                    `
                    }
                  </div>
                `,
                )}
              </div>

              <!-- WhatsApp specific actions -->
              ${
                currentChannel.channel_type === "whatsapp"
                  ? html`
                <div class="notice">
                  <div class="notice-icon">
                    ${iconQrCode}
                  </div>
                  <div style="flex: 1;">
                    <div class="notice-title">WhatsApp 扫码登录</div>
                    <div class="notice-desc">登录时会弹出控制台二维码。连接终端或者运行 CLI \`openclaw channels login --channel whatsapp\`</div>
                    <div class="btn-group" style="margin-top: 12px; display: flex; gap: 8px;">
                      <button class="btn btn-secondary btn-sm" @click=${this.handleWhatsAppLogin} ?disabled=${this.loginLoading}>
                        ${this.loginLoading ? iconLoader2 : iconQrCode} 启动扫码
                      </button>
                    </div>
                  </div>
                </div>
              `
                  : nothing
              }

              <!-- Pairing requests block (when dmPolicy is 'pairing' or default) -->
              ${
                this.shouldShowPairing(currentChannel.channel_type, this.configForm.dmPolicy)
                  ? html`
                <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border, #27272a);">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                    ${iconUserCheck}
                    <span style="font-size: 15px; font-weight: 600; color: var(--text-strong, #fafafa);">配对请求</span>
                    <button class="btn btn-secondary btn-sm" style="margin-left: auto;" @click=${() => this._fetchPairingRequests(currentChannel.id)} ?disabled=${this.pairingLoading}>
                      ${this.pairingLoading ? iconLoader2 : iconRefresh} 刷新
                    </button>
                  </div>

                  ${
                    this.pairingRequests.length > 0
                      ? html`
                    <div class="pairing-list">
                      ${this.pairingRequests.map(
                        (req) => html`
                        <div class="pairing-item">
                          <span class="pairing-code">${req.code}</span>
                          <span class="pairing-meta">
                            ${req.id || "未知用户"}
                            ${req.createdAt ? html` · ${req.createdAt}` : nothing}
                          </span>
                          <button class="btn btn-primary btn-sm" @click=${() => this._handleApproveCode(currentChannel.id, req.code)} ?disabled=${this.approveLoading}>
                            ${iconCheck} 通过
                          </button>
                        </div>
                      `,
                      )}
                    </div>
                  `
                      : html`
                    <div class="pairing-empty">${this.pairingLoading ? "加载中..." : "暂无待审批的配对请求"}</div>
                  `
                  }

                  <div class="pairing-input-row">
                    <input
                      type="text"
                      class="input-base"
                      placeholder="输入配对码（如 L2ZNDN2D）"
                      .value=${this.approveCode}
                      @input=${(e: Event) => {
                        this.approveCode = (e.target as HTMLInputElement).value;
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === "Enter") {
                          this._handleApproveCode(currentChannel.id, this.approveCode);
                        }
                      }}
                    />
                    <button class="btn btn-primary btn-sm" @click=${() => this._handleApproveCode(currentChannel.id, this.approveCode)} ?disabled=${this.approveLoading || !this.approveCode.trim()}>
                      ${this.approveLoading ? iconLoader2 : iconCheck} 通过
                    </button>
                  </div>

                  ${
                    this.approveResult
                      ? html`
                    <div class="test-result ${this.approveResult.success ? "ok" : "err"}" style="margin-top: 12px;">
                      <div>${this.approveResult.success ? iconCheckCircle : iconXCircle}</div>
                      <div style="flex: 1">
                        <div class="test-result-title">${this.approveResult.message}</div>
                      </div>
                    </div>
                  `
                      : nothing
                  }
                </div>
              `
                  : nothing
              }

              <!-- Form Actions Bar -->
              <div class="actions-bar">
                <button
                  class="btn btn-primary"
                  @click=${this.handleSave}
                  ?disabled=${this.saving}
                >
                  ${this.saving ? iconLoader2 : iconCheck}
                  保存设置
                </button>
                
                <button
                  class="btn btn-secondary"
                  @click=${this.handleQuickTest}
                  ?disabled=${this.testing}
                >
                  ${this.testing ? iconLoader2 : iconPlay}
                  快速测试
                </button>
                
                <div style="flex:1;"></div>

                ${
                  !this.showClearConfirm
                    ? html`
                  <button
                    class="btn btn-danger"
                    @click=${this.handleShowClearConfirm}
                    ?disabled=${this.clearing}
                  >
                    ${this.clearing ? iconLoader2 : iconTrash2} 清空配置
                  </button>
                `
                    : html`
                  <div style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
                    <span style="color: var(--accent, #ff5c5c);">确定清空？</span>
                    <button class="btn btn-danger btn-sm" style="background: rgba(255, 92, 92, 0.2);" @click=${this.handleClearConfig}>确定</button>
                    <button class="btn btn-secondary btn-sm" @click=${() => (this.showClearConfirm = false)}>取消</button>
                  </div>
                `
                }
              </div>

              <!-- Test / Action Result block -->
              ${
                this.testResult
                  ? html`
                <div class="test-result ${this.testResult.success ? "ok" : "err"}">
                  <div>${this.testResult.success ? iconCheckCircle : iconXCircle}</div>
                  <div style="flex: 1">
                    <div class="test-result-title">${this.testResult.message}</div>
                    ${this.testResult.error ? html`<div class="test-result-err">${this.testResult.error}</div>` : nothing}
                  </div>
                </div>
              `
                  : nothing
              }

            </div>
          `
              : html`
                  <div class="empty-state">请选择平台频道进行配置</div>
                `
          }
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-config-channels": OpenClawConfigChannels;
  }
}
