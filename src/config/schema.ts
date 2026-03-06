import { CHANNEL_IDS } from "../channels/registry.js";
import { VERSION } from "../version.js";
import type { ConfigUiHint, ConfigUiHints } from "./schema.hints.js";
import { applySensitiveHints, buildBaseHints, mapSensitivePaths } from "./schema.hints.js";
import { applyDerivedTags } from "./schema.tags.js";
import { OpenClawSchema } from "./zod-schema.js";

export type { ConfigUiHint, ConfigUiHints } from "./schema.hints.js";

export type ConfigSchema = ReturnType<typeof OpenClawSchema.toJSONSchema>;

type JsonSchemaNode = Record<string, unknown>;

export type ConfigSchemaResponse = {
  schema: ConfigSchema;
  uiHints: ConfigUiHints;
  version: string;
  generatedAt: string;
};

export type PluginUiMetadata = {
  id: string;
  name?: string;
  description?: string;
  configUiHints?: Record<
    string,
    Pick<ConfigUiHint, "label" | "help" | "tags" | "advanced" | "sensitive" | "placeholder">
  >;
  configSchema?: JsonSchemaNode;
};

export type ChannelUiMetadata = {
  id: string;
  label?: string;
  description?: string;
  configSchema?: JsonSchemaNode;
  configUiHints?: Record<string, ConfigUiHint>;
};

const GROUP_LABELS: Record<string, string> = {
  wizard: "向导",
  update: "更新",
  diagnostics: "诊断",
  logging: "日志",
  gateway: "网关",
  nodeHost: "节点主机",
  agents: "代理",
  tools: "工具",
  bindings: "绑定",
  audio: "音频",
  models: "模型",
  messages: "消息",
  commands: "命令",
  session: "会话",
  cron: "定时任务",
  hooks: "钩子",
  ui: "界面",
  browser: "浏览器",
  talk: "语音",
  channels: "消息频道",
  skills: "技能",
  plugins: "插件",
  discovery: "发现",
  presence: "在线状态",
  voicewake: "语音唤醒",
};

const GROUP_ORDER: Record<string, number> = {
  wizard: 20,
  update: 25,
  diagnostics: 27,
  gateway: 30,
  nodeHost: 35,
  agents: 40,
  tools: 50,
  bindings: 55,
  audio: 60,
  models: 70,
  messages: 80,
  commands: 85,
  session: 90,
  cron: 100,
  hooks: 110,
  ui: 120,
  browser: 130,
  talk: 140,
  channels: 150,
  skills: 200,
  plugins: 205,
  discovery: 210,
  presence: 220,
  voicewake: 230,
  logging: 900,
};

const FIELD_LABELS: Record<string, string> = {
  "meta.lastTouchedVersion": "配置最后修改版本",
  "meta.lastTouchedAt": "配置最后修改时间",
  "update.channel": "更新渠道",
  "update.checkOnStart": "启动时检查更新",
  "diagnostics.enabled": "启用诊断",
  "diagnostics.flags": "诊断标志",
  "diagnostics.otel.enabled": "启用 OpenTelemetry",
  "diagnostics.otel.endpoint": "OpenTelemetry 端点",
  "diagnostics.otel.protocol": "OpenTelemetry 协议",
  "diagnostics.otel.headers": "OpenTelemetry 请求头",
  "diagnostics.otel.serviceName": "OpenTelemetry 服务名称",
  "diagnostics.otel.traces": "启用 OpenTelemetry 追踪",
  "diagnostics.otel.metrics": "启用 OpenTelemetry 指标",
  "diagnostics.otel.logs": "启用 OpenTelemetry 日志",
  "diagnostics.otel.sampleRate": "OpenTelemetry 追踪采样率",
  "diagnostics.otel.flushIntervalMs": "OpenTelemetry 刷新间隔 (毫秒)",
  "diagnostics.cacheTrace.enabled": "启用缓存追踪",
  "diagnostics.cacheTrace.filePath": "缓存追踪文件路径",
  "diagnostics.cacheTrace.includeMessages": "缓存追踪包含消息",
  "diagnostics.cacheTrace.includePrompt": "缓存追踪包含提示词",
  "diagnostics.cacheTrace.includeSystem": "缓存追踪包含系统信息",
  "agents.list.*.identity.avatar": "身份头像",
  "agents.list.*.skills": "代理技能过滤",
  "gateway.remote.url": "远程网关 URL",
  "gateway.remote.sshTarget": "远程网关 SSH 目标",
  "gateway.remote.sshIdentity": "远程网关 SSH 身份",
  "gateway.remote.token": "远程网关令牌",
  "gateway.remote.password": "远程网关密码",
  "gateway.remote.tlsFingerprint": "远程网关 TLS 指纹",
  "gateway.auth.token": "网关令牌",
  "gateway.auth.password": "网关密码",
  "tools.media.image.enabled": "启用图片理解",
  "tools.media.image.maxBytes": "图片理解最大字节数",
  "tools.media.image.maxChars": "图片理解最大字符数",
  "tools.media.image.prompt": "图片理解提示词",
  "tools.media.image.timeoutSeconds": "图片理解超时 (秒)",
  "tools.media.image.attachments": "图片理解附件策略",
  "tools.media.image.models": "图片理解模型",
  "tools.media.image.scope": "图片理解范围",
  "tools.media.models": "媒体理解共享模型",
  "tools.media.concurrency": "媒体理解并发数",
  "tools.media.audio.enabled": "启用音频理解",
  "tools.media.audio.maxBytes": "音频理解最大字节数",
  "tools.media.audio.maxChars": "音频理解最大字符数",
  "tools.media.audio.prompt": "音频理解提示词",
  "tools.media.audio.timeoutSeconds": "音频理解超时 (秒)",
  "tools.media.audio.language": "音频理解语言",
  "tools.media.audio.attachments": "音频理解附件策略",
  "tools.media.audio.models": "音频理解模型",
  "tools.media.audio.scope": "音频理解范围",
  "tools.media.video.enabled": "启用视频理解",
  "tools.media.video.maxBytes": "视频理解最大字节数",
  "tools.media.video.maxChars": "视频理解最大字符数",
  "tools.media.video.prompt": "视频理解提示词",
  "tools.media.video.timeoutSeconds": "视频理解超时 (秒)",
  "tools.media.video.attachments": "视频理解附件策略",
  "tools.media.video.models": "视频理解模型",
  "tools.media.video.scope": "视频理解范围",
  "tools.links.enabled": "启用链接理解",
  "tools.links.maxLinks": "链接理解最大链接数",
  "tools.links.timeoutSeconds": "链接理解超时 (秒)",
  "tools.links.models": "链接理解模型",
  "tools.links.scope": "链接理解范围",
  "tools.profile": "工具配置文件",
  "tools.alsoAllow": "工具白名单附加项",
  "agents.list[].tools.profile": "代理工具配置文件",
  "agents.list[].tools.alsoAllow": "代理工具白名单附加项",
  "tools.byProvider": "按提供商的工具策略",
  "agents.list[].tools.byProvider": "代理按提供商的工具策略",
  "tools.exec.applyPatch.enabled": "启用 apply_patch",
  "tools.exec.applyPatch.allowModels": "apply_patch 模型白名单",
  "tools.exec.notifyOnExit": "执行退出时通知",
  "tools.exec.approvalRunningNoticeMs": "执行审批运行通知 (毫秒)",
  "tools.exec.host": "执行主机",
  "tools.exec.security": "执行安全",
  "tools.exec.ask": "执行询问",
  "tools.exec.node": "执行节点绑定",
  "tools.exec.pathPrepend": "执行 PATH 前置",
  "tools.exec.safeBins": "执行安全二进制文件",
  "tools.message.allowCrossContextSend": "允许跨上下文消息",
  "tools.message.crossContext.allowWithinProvider": "允许跨上下文 (同一提供商)",
  "tools.message.crossContext.allowAcrossProviders": "允许跨上下文 (跨提供商)",
  "tools.message.crossContext.marker.enabled": "跨上下文标记",
  "tools.message.crossContext.marker.prefix": "跨上下文标记前缀",
  "tools.message.crossContext.marker.suffix": "跨上下文标记后缀",
  "tools.message.broadcast.enabled": "启用消息广播",
  "tools.web.search.enabled": "启用网页搜索工具",
  "tools.web.search.provider": "网页搜索提供商",
  "tools.web.search.apiKey": "Brave 搜索 API 密钥",
  "tools.web.search.maxResults": "网页搜索最大结果数",
  "tools.web.search.timeoutSeconds": "网页搜索超时 (秒)",
  "tools.web.search.cacheTtlMinutes": "网页搜索缓存 TTL (分钟)",
  "tools.web.fetch.enabled": "启用网页抓取工具",
  "tools.web.fetch.maxChars": "网页抓取最大字符数",
  "tools.web.fetch.timeoutSeconds": "网页抓取超时 (秒)",
  "tools.web.fetch.cacheTtlMinutes": "网页抓取缓存 TTL (分钟)",
  "tools.web.fetch.maxRedirects": "网页抓取最大重定向数",
  "tools.web.fetch.userAgent": "网页抓取 User-Agent",
  "gateway.controlUi.basePath": "控制界面基础路径",
  "gateway.controlUi.allowInsecureAuth": "允许不安全的控制界面认证",
  "gateway.controlUi.dangerouslyDisableDeviceAuth": "危险：禁用控制界面设备认证",
  "gateway.http.endpoints.chatCompletions.enabled": "OpenAI 聊天补全端点",
  "gateway.reload.mode": "配置重载模式",
  "gateway.reload.debounceMs": "配置重载防抖 (毫秒)",
  "gateway.nodes.browser.mode": "网关节点浏览器模式",
  "gateway.nodes.browser.node": "网关节点浏览器绑定",
  "gateway.nodes.allowCommands": "网关节点白名单 (额外命令)",
  "gateway.nodes.denyCommands": "网关节点黑名单",
  "nodeHost.browserProxy.enabled": "节点浏览器代理启用",
  "nodeHost.browserProxy.allowProfiles": "节点浏览器代理允许的配置文件",
  "skills.load.watch": "监视技能",
  "skills.load.watchDebounceMs": "技能监视防抖 (毫秒)",
  "agents.defaults.workspace": "工作区",
  "agents.defaults.repoRoot": "仓库根目录",
  "agents.defaults.bootstrapMaxChars": "引导最大字符数",
  "agents.defaults.envelopeTimezone": "信封时区",
  "agents.defaults.envelopeTimestamp": "信封时间戳",
  "agents.defaults.envelopeElapsed": "信封已用时间",
  "agents.defaults.memorySearch": "记忆搜索",
  "agents.defaults.memorySearch.enabled": "启用记忆搜索",
  "agents.defaults.memorySearch.sources": "记忆搜索来源",
  "agents.defaults.memorySearch.extraPaths": "额外记忆路径",
  "agents.defaults.memorySearch.experimental.sessionMemory": "记忆搜索会话索引 (实验性)",
  "agents.defaults.memorySearch.provider": "记忆搜索提供商",
  "agents.defaults.memorySearch.remote.baseUrl": "远程嵌入基础 URL",
  "agents.defaults.memorySearch.remote.apiKey": "远程嵌入 API 密钥",
  "agents.defaults.memorySearch.remote.headers": "远程嵌入请求头",
  "agents.defaults.memorySearch.remote.batch.concurrency": "远程批处理并发数",
  "agents.defaults.memorySearch.model": "记忆搜索模型",
  "agents.defaults.memorySearch.fallback": "记忆搜索回退",
  "agents.defaults.memorySearch.local.modelPath": "本地嵌入模型路径",
  "agents.defaults.memorySearch.store.path": "记忆搜索索引路径",
  "agents.defaults.memorySearch.store.vector.enabled": "记忆搜索向量索引",
  "agents.defaults.memorySearch.store.vector.extensionPath": "记忆搜索向量扩展路径",
  "agents.defaults.memorySearch.chunking.tokens": "记忆分块令牌数",
  "agents.defaults.memorySearch.chunking.overlap": "记忆分块重叠令牌数",
  "agents.defaults.memorySearch.sync.onSessionStart": "会话开始时索引",
  "agents.defaults.memorySearch.sync.onSearch": "搜索时索引 (延迟)",
  "agents.defaults.memorySearch.sync.watch": "监视记忆文件",
  "agents.defaults.memorySearch.sync.watchDebounceMs": "记忆监视防抖 (毫秒)",
  "agents.defaults.memorySearch.sync.sessions.deltaBytes": "会话增量字节数",
  "agents.defaults.memorySearch.sync.sessions.deltaMessages": "会话增量消息数",
  "agents.defaults.memorySearch.query.maxResults": "记忆搜索最大结果数",
  "agents.defaults.memorySearch.query.minScore": "记忆搜索最小分数",
  "agents.defaults.memorySearch.query.hybrid.enabled": "记忆搜索混合模式",
  "agents.defaults.memorySearch.query.hybrid.vectorWeight": "记忆搜索向量权重",
  "agents.defaults.memorySearch.query.hybrid.textWeight": "记忆搜索文本权重",
  "agents.defaults.memorySearch.query.hybrid.candidateMultiplier": "记忆搜索混合候选乘数",
  "agents.defaults.memorySearch.cache.enabled": "记忆搜索嵌入缓存",
  "agents.defaults.memorySearch.cache.maxEntries": "记忆搜索嵌入缓存最大条目数",
  // 上下文裁剪
  "agents.defaults.contextPruning": "上下文裁剪",
  "agents.defaults.contextPruning.mode": "上下文裁剪模式",
  "agents.defaults.contextPruning.ttl": "上下文裁剪 TTL",
  "agents.defaults.contextPruning.keepLastAssistants": "保留最后助手消息数",
  "agents.defaults.contextPruning.softTrimRatio": "软裁剪比例",
  "agents.defaults.contextPruning.hardClearRatio": "硬清除比例",
  "agents.defaults.contextPruning.minPrunableToolChars": "最小可裁剪工具字符数",
  "agents.defaults.contextPruning.tools": "上下文裁剪工具",
  "agents.defaults.contextPruning.tools.allow": "上下文裁剪工具白名单",
  "agents.defaults.contextPruning.tools.deny": "上下文裁剪工具黑名单",
  "agents.defaults.contextPruning.softTrim": "软裁剪",
  "agents.defaults.contextPruning.softTrim.maxChars": "软裁剪最大字符数",
  "agents.defaults.contextPruning.softTrim.headChars": "软裁剪头部字符数",
  "agents.defaults.contextPruning.softTrim.tailChars": "软裁剪尾部字符数",
  "agents.defaults.contextPruning.hardClear": "硬清除",
  "agents.defaults.contextPruning.hardClear.enabled": "启用硬清除",
  "agents.defaults.contextPruning.hardClear.placeholder": "硬清除占位符",
  // 压缩
  "agents.defaults.compaction": "上下文压缩",
  "agents.defaults.compaction.mode": "压缩模式",
  "agents.defaults.compaction.reserveTokensFloor": "保留令牌下限",
  "agents.defaults.compaction.maxHistoryShare": "最大历史占比",
  "agents.defaults.compaction.memoryFlush": "记忆刷新",
  "agents.defaults.compaction.memoryFlush.enabled": "启用记忆刷新",
  "agents.defaults.compaction.memoryFlush.softThresholdTokens": "记忆刷新软阈值令牌数",
  "agents.defaults.compaction.memoryFlush.prompt": "记忆刷新提示词",
  "agents.defaults.compaction.memoryFlush.systemPrompt": "记忆刷新系统提示词",
  // 其他代理默认设置
  "agents.defaults.contextTokens": "上下文令牌数",
  "agents.defaults.thinkingDefault": "默认思考级别",
  "agents.defaults.verboseDefault": "默认详细级别",
  "agents.defaults.elevatedDefault": "默认提权级别",
  "agents.defaults.blockStreamingDefault": "默认块流模式",
  "agents.defaults.blockStreamingBreak": "块流断点",
  "agents.defaults.blockStreamingChunk": "块流分块",
  "agents.defaults.blockStreamingCoalesce": "块流合并",
  "agents.defaults.timeoutSeconds": "超时秒数",
  "agents.defaults.mediaMaxMb": "媒体最大 MB",
  "agents.defaults.typingIntervalSeconds": "输入指示间隔秒数",
  "agents.defaults.typingMode": "输入指示模式",
  "agents.defaults.heartbeat": "心跳",
  "agents.defaults.heartbeat.target": "心跳目标",
  "agents.defaults.heartbeat.intervalMs": "心跳间隔 (毫秒)",
  "agents.defaults.maxConcurrent": "最大并发数",
  "agents.defaults.subagents": "子代理",
  "agents.defaults.subagents.maxConcurrent": "子代理最大并发数",
  "agents.defaults.subagents.archiveAfterMinutes": "子代理归档时间 (分钟)",
  "agents.defaults.subagents.model": "子代理模型",
  "agents.defaults.subagents.tools": "子代理工具",
  "auth.profiles": "认证配置文件",
  "auth.order": "认证配置文件顺序",
  "auth.cooldowns.billingBackoffHours": "计费退避 (小时)",
  "auth.cooldowns.billingBackoffHoursByProvider": "计费退避覆盖",
  "auth.cooldowns.billingMaxHours": "计费退避上限 (小时)",
  "auth.cooldowns.failureWindowHours": "故障转移窗口 (小时)",
  "agents.defaults.models": "模型",
  "agents.defaults.model.primary": "主模型",
  "agents.defaults.model.fallbacks": "模型回退",
  "agents.defaults.imageModel.primary": "图像模型",
  "agents.defaults.imageModel.fallbacks": "图像模型回退",
  "agents.defaults.humanDelay.mode": "人类延迟模式",
  "agents.defaults.humanDelay.minMs": "人类延迟最小值 (毫秒)",
  "agents.defaults.humanDelay.maxMs": "人类延迟最大值 (毫秒)",
  "agents.defaults.cliBackends": "CLI 后端",
  "commands.native": "原生命令",
  "commands.nativeSkills": "原生技能命令",
  "commands.text": "文本命令",
  "commands.bash": "允许 Bash 聊天命令",
  "commands.bashForegroundMs": "Bash 前台窗口 (毫秒)",
  "commands.config": "允许 /config",
  "commands.debug": "允许 /debug",
  "commands.restart": "允许重启",
  "commands.useAccessGroups": "使用访问组",
  "ui.seamColor": "强调色",
  "ui.assistant.name": "助手名称",
  "ui.assistant.avatar": "助手头像",
  "browser.evaluateEnabled": "浏览器执行启用",
  "browser.snapshotDefaults": "浏览器快照默认值",
  "browser.snapshotDefaults.mode": "浏览器快照模式",
  "browser.remoteCdpTimeoutMs": "远程 CDP 超时 (毫秒)",
  "browser.remoteCdpHandshakeTimeoutMs": "远程 CDP 握手超时 (毫秒)",
  "session.dmScope": "私信会话范围",
  "session.agentToAgent.maxPingPongTurns": "代理间乒乓轮次",
  "messages.ackReaction": "确认反应表情",
  "messages.ackReactionScope": "确认反应范围",
  "messages.inbound.debounceMs": "入站消息防抖 (毫秒)",
  "talk.apiKey": "语音 API 密钥",
  "channels.whatsapp": "WhatsApp",
  "channels.telegram": "Telegram",
  "channels.telegram.customCommands": "Telegram 自定义命令",
  "channels.discord": "Discord",
  "channels.slack": "Slack",
  "channels.mattermost": "Mattermost",
  "channels.signal": "Signal",
  "channels.imessage": "iMessage",
  "channels.bluebubbles": "BlueBubbles",
  "channels.msteams": "MS Teams",
  "channels.telegram.botToken": "Telegram 机器人令牌",
  "channels.telegram.dmPolicy": "Telegram 私信策略",
  "channels.telegram.streamMode": "Telegram 草稿流模式",
  "channels.telegram.draftChunk.minChars": "Telegram 草稿块最小字符数",
  "channels.telegram.draftChunk.maxChars": "Telegram 草稿块最大字符数",
  "channels.telegram.draftChunk.breakPreference": "Telegram 草稿块断行偏好",
  "channels.telegram.retry.attempts": "Telegram 重试次数",
  "channels.telegram.retry.minDelayMs": "Telegram 重试最小延迟 (毫秒)",
  "channels.telegram.retry.maxDelayMs": "Telegram 重试最大延迟 (毫秒)",
  "channels.telegram.retry.jitter": "Telegram 重试抖动",
  "channels.telegram.network.autoSelectFamily": "Telegram 自动选择协议族",
  "channels.telegram.timeoutSeconds": "Telegram API 超时 (秒)",
  "channels.telegram.capabilities.inlineButtons": "Telegram 内联按钮",
  "channels.whatsapp.dmPolicy": "WhatsApp 私信策略",
  "channels.whatsapp.selfChatMode": "WhatsApp 自聊模式",
  "channels.whatsapp.debounceMs": "WhatsApp 消息防抖 (毫秒)",
  "channels.signal.dmPolicy": "Signal 私信策略",
  "channels.imessage.dmPolicy": "iMessage 私信策略",
  "channels.bluebubbles.dmPolicy": "BlueBubbles 私信策略",
  "channels.discord.dm.policy": "Discord 私信策略",
  "channels.discord.retry.attempts": "Discord 重试次数",
  "channels.discord.retry.minDelayMs": "Discord 重试最小延迟 (毫秒)",
  "channels.discord.retry.maxDelayMs": "Discord 重试最大延迟 (毫秒)",
  "channels.discord.retry.jitter": "Discord 重试抖动",
  "channels.discord.maxLinesPerMessage": "Discord 每条消息最大行数",
  "channels.discord.intents.presence": "Discord 在线状态意图",
  "channels.discord.intents.guildMembers": "Discord 服务器成员意图",
  "channels.discord.pluralkit.enabled": "Discord PluralKit 启用",
  "channels.discord.pluralkit.token": "Discord PluralKit 令牌",
  "channels.slack.dm.policy": "Slack 私信策略",
  "channels.slack.allowBots": "Slack 允许机器人消息",
  "channels.discord.token": "Discord 机器人令牌",
  "channels.slack.botToken": "Slack 机器人令牌",
  "channels.slack.appToken": "Slack 应用令牌",
  "channels.slack.userToken": "Slack 用户令牌",
  "channels.slack.userTokenReadOnly": "Slack 用户令牌只读",
  "channels.slack.thread.historyScope": "Slack 线程历史范围",
  "channels.slack.thread.inheritParent": "Slack 线程继承父级",
  "channels.mattermost.botToken": "Mattermost 机器人令牌",
  "channels.mattermost.baseUrl": "Mattermost 基础 URL",
  "channels.mattermost.chatmode": "Mattermost 聊天模式",
  "channels.mattermost.oncharPrefixes": "Mattermost 触发前缀",
  "channels.mattermost.requireMention": "Mattermost 需要提及",
  "channels.signal.account": "Signal 账户",
  "channels.imessage.cliPath": "iMessage CLI 路径",
  "agents.list[].identity.avatar": "代理头像",
  "discovery.mdns.mode": "mDNS 发现模式",
  "plugins.enabled": "启用插件",
  "plugins.allow": "插件白名单",
  "plugins.deny": "插件黑名单",
  "plugins.load.paths": "插件加载路径",
  "plugins.slots": "插件槽位",
  "plugins.slots.memory": "记忆插件",
  "plugins.entries": "插件条目",
  "plugins.entries.*.enabled": "插件启用",
  "plugins.entries.*.config": "插件配置",
  "plugins.installs": "插件安装记录",
  "plugins.installs.*.source": "插件安装来源",
  "plugins.installs.*.spec": "插件安装规格",
  "plugins.installs.*.sourcePath": "插件安装源路径",
  "plugins.installs.*.installPath": "插件安装路径",
  "plugins.installs.*.version": "插件安装版本",
  "plugins.installs.*.installedAt": "插件安装时间",
};

const FIELD_HELP: Record<string, string> = {
  "meta.lastTouchedVersion": "OpenClaw 写入配置时自动设置。",
  "meta.lastTouchedAt": "上次配置写入的 ISO 时间戳（自动设置）。",
  "update.channel": '用于 git + npm 安装的更新渠道（"stable"、"beta" 或 "dev"）。',
  "update.checkOnStart": "网关启动时检查 npm 更新（默认：true）。",
  "gateway.remote.url": "远程网关 WebSocket URL（ws:// 或 wss://）。",
  "gateway.remote.tlsFingerprint": "远程网关的预期 sha256 TLS 指纹（用于防止中间人攻击）。",
  "gateway.remote.sshTarget":
    "通过 SSH 连接远程网关（将网关端口隧道到本地）。格式：user@host 或 user@host:port。",
  "gateway.remote.sshIdentity": "可选的 SSH 身份文件路径（传递给 ssh -i）。",
  "agents.list[].identity.avatar": "头像图片路径（仅相对于代理工作区）或远程 URL/data URL。",
  "discovery.mdns.mode":
    'mDNS 广播模式（"minimal" 默认，"full" 包含 cliPath/sshPort，"off" 禁用 mDNS）。',
  "gateway.auth.token":
    "默认情况下网关访问需要此令牌（除非使用 Tailscale Serve 身份）；非回环绑定时必需。",
  "gateway.auth.password": "Tailscale funnel 需要此密码。",
  "gateway.controlUi.basePath": "控制界面服务的可选 URL 前缀（例如 /openclaw）。",
  "gateway.controlUi.allowInsecureAuth":
    "允许通过不安全的 HTTP 进行控制界面认证（仅令牌；不推荐）。",
  "gateway.controlUi.dangerouslyDisableDeviceAuth":
    "危险。禁用控制界面设备身份检查（仅令牌/密码）。",
  "gateway.http.endpoints.chatCompletions.enabled":
    "启用 OpenAI 兼容的 `POST /v1/chat/completions` 端点（默认：false）。",
  "gateway.reload.mode": '配置更改的热重载策略（推荐 "hybrid"）。',
  "gateway.reload.debounceMs": "应用配置更改前的防抖窗口（毫秒）。",
  "gateway.nodes.browser.mode":
    '节点浏览器路由（"auto" = 选择单个已连接的浏览器节点，"manual" = 需要节点参数，"off" = 禁用）。',
  "gateway.nodes.browser.node": "将浏览器路由绑定到特定节点 ID 或名称（可选）。",
  "gateway.nodes.allowCommands": "除网关默认值外允许的额外 node.invoke 命令（命令字符串数组）。",
  "gateway.nodes.denyCommands": "即使存在于节点声明或默认白名单中也要阻止的命令。",
  "nodeHost.browserProxy.enabled": "通过节点代理暴露本地浏览器控制服务器。",
  "nodeHost.browserProxy.allowProfiles": "通过节点代理暴露的浏览器配置文件名称的可选白名单。",
  "diagnostics.flags":
    '按标志启用目标诊断日志（例如 ["telegram.http"]）。支持通配符如 "telegram.*" 或 "*"。',
  "diagnostics.cacheTrace.enabled": "为嵌入式代理运行记录缓存追踪快照（默认：false）。",
  "diagnostics.cacheTrace.filePath":
    "缓存追踪日志的 JSONL 输出路径（默认：$OPENCLAW_STATE_DIR/logs/cache-trace.jsonl）。",
  "diagnostics.cacheTrace.includeMessages": "在追踪输出中包含完整消息负载（默认：true）。",
  "diagnostics.cacheTrace.includePrompt": "在追踪输出中包含提示词文本（默认：true）。",
  "diagnostics.cacheTrace.includeSystem": "在追踪输出中包含系统提示词（默认：true）。",
  "tools.exec.applyPatch.enabled": "实验性。当工具策略允许时，为 OpenAI 模型启用 apply_patch。",
  "tools.exec.applyPatch.allowModels":
    '可选的模型 ID 白名单（例如 "gpt-5.2" 或 "openai/gpt-5.2"）。',
  "tools.exec.notifyOnExit": "为 true 时（默认），后台执行会话在退出时排队系统事件并请求心跳。",
  "tools.exec.pathPrepend": "执行运行时要前置到 PATH 的目录（网关/沙箱）。",
  "tools.exec.safeBins": "允许仅标准输入的安全二进制文件在没有显式白名单条目的情况下运行。",
  "tools.message.allowCrossContextSend": "旧版覆盖：允许跨所有提供商的跨上下文发送。",
  "tools.message.crossContext.allowWithinProvider":
    "允许向同一提供商内的其他频道发送（默认：true）。",
  "tools.message.crossContext.allowAcrossProviders": "允许跨不同提供商发送（默认：false）。",
  "tools.message.crossContext.marker.enabled": "跨上下文发送时添加可见的来源标记（默认：true）。",
  "tools.message.crossContext.marker.prefix": '跨上下文标记的文本前缀（支持 "{channel}"）。',
  "tools.message.crossContext.marker.suffix": '跨上下文标记的文本后缀（支持 "{channel}"）。',
  "tools.message.broadcast.enabled": "启用广播操作（默认：true）。",
  "tools.web.search.enabled": "启用 web_search 工具（需要提供商 API 密钥）。",
  "tools.web.search.provider": '搜索提供商（"brave" 或 "perplexity"）。',
  "tools.web.search.apiKey": "Brave 搜索 API 密钥（回退：BRAVE_API_KEY 环境变量）。",
  "tools.web.search.maxResults": "返回的默认结果数量（1-10）。",
  "tools.web.search.timeoutSeconds": "web_search 请求的超时秒数。",
  "tools.web.search.cacheTtlMinutes": "web_search 结果的缓存 TTL（分钟）。",
  "tools.web.search.perplexity.apiKey":
    "Perplexity 或 OpenRouter API 密钥（回退：PERPLEXITY_API_KEY 或 OPENROUTER_API_KEY 环境变量）。",
  "tools.web.search.perplexity.baseUrl":
    "Perplexity 基础 URL 覆盖（默认：https://openrouter.ai/api/v1 或 https://api.perplexity.ai）。",
  "tools.web.search.perplexity.model": 'Perplexity 模型覆盖（默认："perplexity/sonar-pro"）。',
  "tools.web.fetch.enabled": "启用 web_fetch 工具（轻量级 HTTP 抓取）。",
  "tools.web.fetch.maxChars": "web_fetch 返回的最大字符数（截断）。",
  "tools.web.fetch.timeoutSeconds": "web_fetch 请求的超时秒数。",
  "tools.web.fetch.cacheTtlMinutes": "web_fetch 结果的缓存 TTL（分钟）。",
  "tools.web.fetch.maxRedirects": "web_fetch 允许的最大重定向数（默认：3）。",
  "tools.web.fetch.userAgent": "覆盖 web_fetch 请求的 User-Agent 头。",
  "tools.web.fetch.readability": "使用 Readability 从 HTML 提取主要内容（回退到基本 HTML 清理）。",
  "tools.web.fetch.firecrawl.enabled": "为 web_fetch 启用 Firecrawl 回退（如果已配置）。",
  "tools.web.fetch.firecrawl.apiKey": "Firecrawl API 密钥（回退：FIRECRAWL_API_KEY 环境变量）。",
  "tools.web.fetch.firecrawl.baseUrl":
    "Firecrawl 基础 URL（例如 https://api.firecrawl.dev 或自定义端点）。",
  "tools.web.fetch.firecrawl.onlyMainContent":
    "为 true 时，Firecrawl 仅返回主要内容（默认：true）。",
  "tools.web.fetch.firecrawl.maxAgeMs": "当 API 支持时，Firecrawl 缓存结果的 maxAge（毫秒）。",
  "tools.web.fetch.firecrawl.timeoutSeconds": "Firecrawl 请求的超时秒数。",
  "channels.slack.allowBots": "允许机器人发送的消息触发 Slack 回复（默认：false）。",
  "channels.slack.thread.historyScope":
    'Slack 线程历史上下文的范围（"thread" 按线程隔离；"channel" 重用频道历史）。',
  "channels.slack.thread.inheritParent":
    "如果为 true，Slack 线程会话继承父频道的对话记录（默认：false）。",
  "channels.mattermost.botToken": "来自 Mattermost 系统控制台 -> 集成 -> 机器人账户的机器人令牌。",
  "channels.mattermost.baseUrl":
    "您的 Mattermost 服务器的基础 URL（例如 https://chat.example.com）。",
  "channels.mattermost.chatmode":
    '在提及时回复频道消息（"oncall"），在触发字符（">" 或 "!"）时回复（"onchar"），或在每条消息时回复（"onmessage"）。',
  "channels.mattermost.oncharPrefixes": 'onchar 模式的触发前缀（默认：[">", "!"]）。',
  "channels.mattermost.requireMention": "在频道中响应前需要 @提及（默认：true）。",
  "auth.profiles": "命名的认证配置文件（提供商 + 模式 + 可选邮箱）。",
  "auth.order": "每个提供商的有序认证配置文件 ID（用于自动故障转移）。",
  "auth.cooldowns.billingBackoffHours":
    "配置文件因计费/额度不足失败时的基础退避时间（小时）（默认：5）。",
  "auth.cooldowns.billingBackoffHoursByProvider": "可选的按提供商计费退避覆盖（小时）。",
  "auth.cooldowns.billingMaxHours": "计费退避上限（小时）（默认：24）。",
  "auth.cooldowns.failureWindowHours": "退避计数器的故障窗口（小时）（默认：24）。",
  "agents.defaults.bootstrapMaxChars":
    "截断前注入系统提示词的每个工作区引导文件的最大字符数（默认：20000）。",
  "agents.defaults.repoRoot": "系统提示词运行时行中显示的可选仓库根目录（覆盖自动检测）。",
  "agents.defaults.envelopeTimezone":
    '消息信封的时区（"utc"、"local"、"user" 或 IANA 时区字符串）。',
  "agents.defaults.envelopeTimestamp": '在消息信封中包含绝对时间戳（"on" 或 "off"）。',
  "agents.defaults.envelopeElapsed": '在消息信封中包含已用时间（"on" 或 "off"）。',
  "agents.defaults.models": "已配置的模型目录（键为完整的提供商/模型 ID）。",
  "agents.defaults.memorySearch": "对 MEMORY.md 和 memory/*.md 的向量搜索（支持按代理覆盖）。",
  "agents.defaults.memorySearch.sources":
    '记忆搜索要索引的来源（默认：["memory"]；添加 "sessions" 以包含会话记录）。',
  "agents.defaults.memorySearch.extraPaths":
    "记忆搜索要包含的额外路径（目录或 .md 文件；相对路径从工作区解析）。",
  "agents.defaults.memorySearch.experimental.sessionMemory":
    "为记忆搜索启用实验性会话记录索引（默认：false）。",
  "agents.defaults.memorySearch.provider": '嵌入提供商（"openai"、"gemini" 或 "local"）。',
  "agents.defaults.memorySearch.remote.baseUrl":
    "远程嵌入的自定义基础 URL（OpenAI 兼容代理或 Gemini 覆盖）。",
  "agents.defaults.memorySearch.remote.apiKey": "远程嵌入提供商的自定义 API 密钥。",
  "agents.defaults.memorySearch.remote.headers":
    "远程嵌入的额外请求头（合并；remote 覆盖 OpenAI 请求头）。",
  "agents.defaults.memorySearch.remote.batch.enabled":
    "为记忆嵌入启用批处理 API（OpenAI/Gemini；默认：true）。",
  "agents.defaults.memorySearch.remote.batch.wait": "索引时等待批处理完成（默认：true）。",
  "agents.defaults.memorySearch.remote.batch.concurrency":
    "记忆索引的最大并发嵌入批处理作业数（默认：2）。",
  "agents.defaults.memorySearch.remote.batch.pollIntervalMs":
    "批处理状态的轮询间隔（毫秒）（默认：2000）。",
  "agents.defaults.memorySearch.remote.batch.timeoutMinutes":
    "批处理索引的超时时间（分钟）（默认：60）。",
  "agents.defaults.memorySearch.local.modelPath":
    "本地 GGUF 模型路径或 hf: URI（node-llama-cpp）。",
  "agents.defaults.memorySearch.fallback":
    '嵌入失败时的回退提供商（"openai"、"gemini"、"local" 或 "none"）。',
  "agents.defaults.memorySearch.store.path":
    "SQLite 索引路径（默认：~/.openclawcn/memory/{agentId}.sqlite）。",
  "agents.defaults.memorySearch.store.vector.enabled":
    "为向量搜索启用 sqlite-vec 扩展（默认：true）。",
  "agents.defaults.memorySearch.store.vector.extensionPath":
    "sqlite-vec 扩展库的可选覆盖路径（.dylib/.so/.dll）。",
  "agents.defaults.memorySearch.query.hybrid.enabled":
    "为记忆启用混合 BM25 + 向量搜索（默认：true）。",
  "agents.defaults.memorySearch.query.hybrid.vectorWeight": "合并结果时向量相似度的权重（0-1）。",
  "agents.defaults.memorySearch.query.hybrid.textWeight":
    "合并结果时 BM25 文本相关性的权重（0-1）。",
  "agents.defaults.memorySearch.query.hybrid.candidateMultiplier": "候选池大小的乘数（默认：4）。",
  "agents.defaults.memorySearch.cache.enabled":
    "在 SQLite 中缓存分块嵌入以加速重新索引和频繁更新（默认：true）。",
  "agents.defaults.memorySearch.cache.maxEntries": "缓存嵌入的可选上限（尽力而为）。",
  "agents.defaults.memorySearch.sync.onSearch": "延迟同步：在更改后的搜索时安排重新索引。",
  "agents.defaults.memorySearch.sync.watch": "监视记忆文件的更改（chokidar）。",
  "agents.defaults.memorySearch.sync.sessions.deltaBytes":
    "会话记录触发重新索引前的最小追加字节数（默认：100000）。",
  "agents.defaults.memorySearch.sync.sessions.deltaMessages":
    "会话记录触发重新索引前的最小追加 JSONL 行数（默认：50）。",
  "plugins.enabled": "启用插件/扩展加载（默认：true）。",
  "plugins.allow": "可选的插件 ID 白名单；设置后，仅加载列出的插件。",
  "plugins.deny": "可选的插件 ID 黑名单；黑名单优先于白名单。",
  "plugins.load.paths": "要加载的额外插件文件或目录。",
  "plugins.slots": "选择哪些插件拥有独占槽位（记忆等）。",
  "plugins.slots.memory": '按 ID 选择活动的记忆插件，或 "none" 禁用记忆插件。',
  "plugins.entries": "按插件 ID 键控的每个插件设置（启用/禁用 + 配置负载）。",
  "plugins.entries.*.enabled": "覆盖此条目的插件启用/禁用（需要重启）。",
  "plugins.entries.*.config": "插件定义的配置负载（架构由插件提供）。",
  "plugins.installs": "CLI 管理的安装元数据（由 `openclaw plugins update` 用于定位安装源）。",
  "plugins.installs.*.source": '安装源（"npm"、"archive" 或 "path"）。',
  "plugins.installs.*.spec": "用于安装的原始 npm 规格（如果源是 npm）。",
  "plugins.installs.*.sourcePath": "用于安装的原始归档/路径（如果有）。",
  "plugins.installs.*.installPath": "解析的安装目录（通常是 ~/.openclawcn/extensions/<id>）。",
  "plugins.installs.*.version": "安装时记录的版本（如果可用）。",
  "plugins.installs.*.installedAt": "上次安装/更新的 ISO 时间戳。",
  "agents.list.*.identity.avatar": "代理头像（工作区相对路径、http(s) URL 或 data URI）。",
  "agents.defaults.model.primary": "主模型（提供商/模型）。",
  "agents.defaults.model.fallbacks": "有序的回退模型（提供商/模型）。主模型失败时使用。",
  "agents.defaults.imageModel.primary":
    "可选的图像模型（提供商/模型），当主模型缺少图像输入时使用。",
  "agents.defaults.imageModel.fallbacks": "有序的回退图像模型（提供商/模型）。",
  "agents.defaults.cliBackends": "可选的 CLI 后端用于纯文本回退（claude-cli 等）。",
  "agents.defaults.humanDelay.mode": '块回复的延迟风格（"off"、"natural"、"custom"）。',
  "agents.defaults.humanDelay.minMs": "自定义 humanDelay 的最小延迟（毫秒）（默认：800）。",
  "agents.defaults.humanDelay.maxMs": "自定义 humanDelay 的最大延迟（毫秒）（默认：2500）。",
  "commands.native": "向支持的频道（Discord/Slack/Telegram）注册原生命令。",
  "commands.nativeSkills": "向支持的频道注册原生技能命令（用户可调用的技能）。",
  "commands.text": "允许文本命令解析（仅斜杠命令）。",
  "commands.bash":
    "允许 bash 聊天命令（`!`；`/bash` 别名）运行主机 shell 命令（默认：false；需要 tools.elevated）。",
  "commands.bashForegroundMs": "bash 后台化前等待的时间（默认：2000；0 立即后台化）。",
  "commands.config": "允许 /config 聊天命令读写磁盘上的配置（默认：false）。",
  "commands.debug": "允许 /debug 聊天命令进行仅运行时覆盖（默认：false）。",
  "commands.restart": "允许 /restart 和网关重启工具操作（默认：false）。",
  "commands.useAccessGroups": "为命令强制执行访问组白名单/策略。",
  "session.dmScope":
    '私信会话范围："main" 保持连续性；"per-peer"、"per-channel-peer" 或 "per-account-channel-peer" 隔离私信历史（推荐用于共享收件箱/多账户）。',
  "session.identityLinks":
    "将规范身份映射到提供商前缀的对等 ID 以进行私信会话链接（示例：telegram:123456）。",
  "channels.telegram.configWrites": "允许 Telegram 响应频道事件/命令时写入配置（默认：true）。",
  "channels.slack.configWrites": "允许 Slack 响应频道事件/命令时写入配置（默认：true）。",
  "channels.mattermost.configWrites": "允许 Mattermost 响应频道事件/命令时写入配置（默认：true）。",
  "channels.discord.configWrites": "允许 Discord 响应频道事件/命令时写入配置（默认：true）。",
  "channels.whatsapp.configWrites": "允许 WhatsApp 响应频道事件/命令时写入配置（默认：true）。",
  "channels.signal.configWrites": "允许 Signal 响应频道事件/命令时写入配置（默认：true）。",
  "channels.imessage.configWrites": "允许 iMessage 响应频道事件/命令时写入配置（默认：true）。",
  "channels.msteams.configWrites":
    "允许 Microsoft Teams 响应频道事件/命令时写入配置（默认：true）。",
  "channels.discord.commands.native": '覆盖 Discord 的原生命令（布尔值或 "auto"）。',
  "channels.discord.commands.nativeSkills": '覆盖 Discord 的原生技能命令（布尔值或 "auto"）。',
  "channels.telegram.commands.native": '覆盖 Telegram 的原生命令（布尔值或 "auto"）。',
  "channels.telegram.commands.nativeSkills": '覆盖 Telegram 的原生技能命令（布尔值或 "auto"）。',
  "channels.slack.commands.native": '覆盖 Slack 的原生命令（布尔值或 "auto"）。',
  "channels.slack.commands.nativeSkills": '覆盖 Slack 的原生技能命令（布尔值或 "auto"）。',
  "session.agentToAgent.maxPingPongTurns": "请求者和目标之间的最大回复轮次（0-5）。",
  "channels.telegram.customCommands":
    "额外的 Telegram 机器人菜单命令（与原生命令合并；冲突被忽略）。",
  "messages.ackReaction": "用于确认入站消息的表情反应（空值禁用）。",
  "messages.ackReactionScope":
    '何时发送确认反应（"group-mentions"、"group-all"、"direct"、"all"）。',
  "messages.inbound.debounceMs":
    "批量处理来自同一发送者的快速入站消息的防抖窗口（毫秒）（0 禁用）。",
  "channels.telegram.dmPolicy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.telegram.allowFrom=["*"]。',
  "channels.telegram.streamMode":
    "Telegram 回复的草稿流模式（off | partial | block）。与块流分开；需要私有主题 + sendMessageDraft。",
  "channels.telegram.draftChunk.minChars":
    '当 channels.telegram.streamMode="block" 时，发出 Telegram 草稿更新前的最小字符数（默认：200）。',
  "channels.telegram.draftChunk.maxChars":
    '当 channels.telegram.streamMode="block" 时，Telegram 草稿更新块的目标最大大小（默认：800；限制为 channels.telegram.textChunkLimit）。',
  "channels.telegram.draftChunk.breakPreference":
    "Telegram 草稿块的首选断点（paragraph | newline | sentence）。默认：paragraph。",
  "channels.telegram.retry.attempts": "出站 Telegram API 调用的最大重试次数（默认：3）。",
  "channels.telegram.retry.minDelayMs": "Telegram 出站调用的最小重试延迟（毫秒）。",
  "channels.telegram.retry.maxDelayMs": "Telegram 出站调用的最大重试延迟上限（毫秒）。",
  "channels.telegram.retry.jitter": "应用于 Telegram 重试延迟的抖动因子（0-1）。",
  "channels.telegram.network.autoSelectFamily":
    "覆盖 Telegram 的 Node autoSelectFamily（true=启用，false=禁用）。",
  "channels.telegram.timeoutSeconds": "Telegram API 请求中止前的最大秒数（默认：500，按 grammY）。",
  "channels.whatsapp.dmPolicy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.whatsapp.allowFrom=["*"]。',
  "channels.whatsapp.selfChatMode": "同号设置（机器人使用您的个人 WhatsApp 号码）。",
  "channels.whatsapp.debounceMs":
    "批量处理来自同一发送者的快速连续消息的防抖窗口（毫秒）（0 禁用）。",
  "channels.signal.dmPolicy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.signal.allowFrom=["*"]。',
  "channels.imessage.dmPolicy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.imessage.allowFrom=["*"]。',
  "channels.bluebubbles.dmPolicy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.bluebubbles.allowFrom=["*"]。',
  "channels.discord.dm.policy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.discord.dm.allowFrom=["*"]。',
  "channels.discord.retry.attempts": "出站 Discord API 调用的最大重试次数（默认：3）。",
  "channels.discord.retry.minDelayMs": "Discord 出站调用的最小重试延迟（毫秒）。",
  "channels.discord.retry.maxDelayMs": "Discord 出站调用的最大重试延迟上限（毫秒）。",
  "channels.discord.retry.jitter": "应用于 Discord 重试延迟的抖动因子（0-1）。",
  "channels.discord.maxLinesPerMessage": "每条 Discord 消息的软最大行数（默认：17）。",
  "channels.discord.intents.presence":
    "启用 Guild Presences 特权意图。还必须在 Discord 开发者门户中启用。允许跟踪用户活动（例如 Spotify）。默认：false。",
  "channels.discord.intents.guildMembers":
    "启用 Guild Members 特权意图。还必须在 Discord 开发者门户中启用。默认：false。",
  "channels.discord.pluralkit.enabled": "解析 PluralKit 代理消息并将系统成员视为不同的发送者。",
  "channels.discord.pluralkit.token": "用于解析私有系统或成员的可选 PluralKit 令牌。",
  "channels.slack.dm.policy":
    '私信访问控制（推荐 "pairing"）。"open" 需要 channels.slack.dm.allowFrom=["*"]。',
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  "gateway.remote.url": "ws://host:28789",
  "gateway.remote.tlsFingerprint": "sha256:ab12cd34…",
  "gateway.remote.sshTarget": "user@host",
  "gateway.controlUi.basePath": "/openclaw",
  "channels.mattermost.baseUrl": "https://chat.example.com",
  "agents.list[].identity.avatar": "avatars/openclaw.png",
};

const SENSITIVE_PATTERNS = [/token/i, /password/i, /secret/i, /api.?key/i];

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(path));
}

type JsonSchemaObject = JsonSchemaNode & {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  additionalProperties?: JsonSchemaObject | boolean;
};

function cloneSchema<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function asSchemaObject(value: unknown): JsonSchemaObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonSchemaObject;
}

function isObjectSchema(schema: JsonSchemaObject): boolean {
  const type = schema.type;
  if (type === "object") {
    return true;
  }
  if (Array.isArray(type) && type.includes("object")) {
    return true;
  }
  return Boolean(schema.properties || schema.additionalProperties);
}

function mergeObjectSchema(base: JsonSchemaObject, extension: JsonSchemaObject): JsonSchemaObject {
  const mergedRequired = new Set<string>([...(base.required ?? []), ...(extension.required ?? [])]);
  const merged: JsonSchemaObject = {
    ...base,
    ...extension,
    properties: {
      ...base.properties,
      ...extension.properties,
    },
  };
  if (mergedRequired.size > 0) {
    merged.required = Array.from(mergedRequired);
  }
  const additional = extension.additionalProperties ?? base.additionalProperties;
  if (additional !== undefined) {
    merged.additionalProperties = additional;
  }
  return merged;
}

function collectExtensionHintKeys(
  hints: ConfigUiHints,
  plugins: PluginUiMetadata[],
  channels: ChannelUiMetadata[],
): Set<string> {
  const pluginPrefixes = plugins
    .map((plugin) => plugin.id.trim())
    .filter(Boolean)
    .map((id) => `plugins.entries.${id}`);
  const channelPrefixes = channels
    .map((channel) => channel.id.trim())
    .filter(Boolean)
    .map((id) => `channels.${id}`);
  const prefixes = [...pluginPrefixes, ...channelPrefixes];

  return new Set(
    Object.keys(hints).filter((key) =>
      prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`)),
    ),
  );
}

function applyPluginHints(hints: ConfigUiHints, plugins: PluginUiMetadata[]): ConfigUiHints {
  const next: ConfigUiHints = { ...hints };
  for (const plugin of plugins) {
    const id = plugin.id.trim();
    if (!id) {
      continue;
    }
    const name = (plugin.name ?? id).trim() || id;
    const basePath = `plugins.entries.${id}`;

    next[basePath] = {
      ...next[basePath],
      label: name,
      help: plugin.description ? `${plugin.description} (插件: ${id})` : `插件条目 ${id}。`,
    };
    next[`${basePath}.enabled`] = {
      ...next[`${basePath}.enabled`],
      label: `启用 ${name}`,
    };
    next[`${basePath}.config`] = {
      ...next[`${basePath}.config`],
      label: `${name} 配置`,
      help: `${id} 的插件定义配置。`,
    };

    const uiHints = plugin.configUiHints ?? {};
    for (const [relPathRaw, hint] of Object.entries(uiHints)) {
      const relPath = relPathRaw.trim().replace(/^\./, "");
      if (!relPath) {
        continue;
      }
      const key = `${basePath}.config.${relPath}`;
      next[key] = {
        ...next[key],
        ...hint,
      };
    }
  }
  return next;
}

function applyChannelHints(hints: ConfigUiHints, channels: ChannelUiMetadata[]): ConfigUiHints {
  const next: ConfigUiHints = { ...hints };
  for (const channel of channels) {
    const id = channel.id.trim();
    if (!id) {
      continue;
    }
    const basePath = `channels.${id}`;
    const current = next[basePath] ?? {};
    const label = channel.label?.trim();
    const help = channel.description?.trim();
    next[basePath] = {
      ...current,
      ...(label ? { label } : {}),
      ...(help ? { help } : {}),
    };

    const uiHints = channel.configUiHints ?? {};
    for (const [relPathRaw, hint] of Object.entries(uiHints)) {
      const relPath = relPathRaw.trim().replace(/^\./, "");
      if (!relPath) {
        continue;
      }
      const key = `${basePath}.${relPath}`;
      next[key] = {
        ...next[key],
        ...hint,
      };
    }
  }
  return next;
}

/**
 * Collect the set of config-hint keys that were contributed by plugins and
 * channels so that {@link applySensitiveHints} can limit sensitive-path
 * detection to extension-provided paths.
 *
 * This function was missing after commit 96318641d merged an unfinished PR.
 */
function collectExtensionHintKeys(
  _hints: ConfigUiHints,
  plugins: PluginUiMetadata[],
  channels: ChannelUiMetadata[],
): Set<string> {
  const keys = new Set<string>();
  for (const plugin of plugins) {
    const id = plugin.id.trim();
    if (!id) continue;
    const basePath = `plugins.entries.${id}`;
    keys.add(basePath);
    keys.add(`${basePath}.enabled`);
    keys.add(`${basePath}.config`);
    const uiHints = plugin.configUiHints ?? {};
    for (const relPathRaw of Object.keys(uiHints)) {
      const relPath = relPathRaw.trim().replace(/^\./, "");
      if (relPath) keys.add(`${basePath}.config.${relPath}`);
    }
  }
  for (const channel of channels) {
    const id = channel.id.trim();
    if (!id) continue;
    const basePath = `channels.${id}`;
    keys.add(basePath);
    const uiHints = channel.configUiHints ?? {};
    for (const relPathRaw of Object.keys(uiHints)) {
      const relPath = relPathRaw.trim().replace(/^\./, "");
      if (relPath) keys.add(`${basePath}.${relPath}`);
    }
  }
  return keys;
}

function listHeartbeatTargetChannels(channels: ChannelUiMetadata[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of CHANNEL_IDS) {
    const normalized = id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  for (const channel of channels) {
    const normalized = channel.id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function applyHeartbeatTargetHints(
  hints: ConfigUiHints,
  channels: ChannelUiMetadata[],
): ConfigUiHints {
  const next: ConfigUiHints = { ...hints };
  const channelList = listHeartbeatTargetChannels(channels);
  const channelHelp = channelList.length ? ` 已知频道：${channelList.join(", ")}。` : "";
  const help = `投递目标（"last"、"none" 或频道 ID）。${channelHelp}`;
  const paths = ["agents.defaults.heartbeat.target", "agents.list.*.heartbeat.target"];
  for (const path of paths) {
    const current = next[path] ?? {};
    next[path] = {
      ...current,
      help: current.help ?? help,
      placeholder: current.placeholder ?? "last",
    };
  }
  return next;
}

function applyPluginSchemas(schema: ConfigSchema, plugins: PluginUiMetadata[]): ConfigSchema {
  const next = cloneSchema(schema);
  const root = asSchemaObject(next);
  const pluginsNode = asSchemaObject(root?.properties?.plugins);
  const entriesNode = asSchemaObject(pluginsNode?.properties?.entries);
  if (!entriesNode) {
    return next;
  }

  const entryBase = asSchemaObject(entriesNode.additionalProperties);
  const entryProperties = entriesNode.properties ?? {};
  entriesNode.properties = entryProperties;

  for (const plugin of plugins) {
    if (!plugin.configSchema) {
      continue;
    }
    const entrySchema = entryBase
      ? cloneSchema(entryBase)
      : ({ type: "object" } as JsonSchemaObject);
    const entryObject = asSchemaObject(entrySchema) ?? ({ type: "object" } as JsonSchemaObject);
    const baseConfigSchema = asSchemaObject(entryObject.properties?.config);
    const pluginSchema = asSchemaObject(plugin.configSchema);
    const nextConfigSchema =
      baseConfigSchema &&
      pluginSchema &&
      isObjectSchema(baseConfigSchema) &&
      isObjectSchema(pluginSchema)
        ? mergeObjectSchema(baseConfigSchema, pluginSchema)
        : cloneSchema(plugin.configSchema);

    entryObject.properties = {
      ...entryObject.properties,
      config: nextConfigSchema,
    };
    entryProperties[plugin.id] = entryObject;
  }

  return next;
}

function applyChannelSchemas(schema: ConfigSchema, channels: ChannelUiMetadata[]): ConfigSchema {
  const next = cloneSchema(schema);
  const root = asSchemaObject(next);
  const channelsNode = asSchemaObject(root?.properties?.channels);
  if (!channelsNode) {
    return next;
  }
  const channelProps = channelsNode.properties ?? {};
  channelsNode.properties = channelProps;

  for (const channel of channels) {
    if (!channel.configSchema) {
      continue;
    }
    const existing = asSchemaObject(channelProps[channel.id]);
    const incoming = asSchemaObject(channel.configSchema);
    if (existing && incoming && isObjectSchema(existing) && isObjectSchema(incoming)) {
      channelProps[channel.id] = mergeObjectSchema(existing, incoming);
    } else {
      channelProps[channel.id] = cloneSchema(channel.configSchema);
    }
  }

  return next;
}

let cachedBase: ConfigSchemaResponse | null = null;
const mergedSchemaCache = new Map<string, ConfigSchemaResponse>();
const MERGED_SCHEMA_CACHE_MAX = 64;

function buildMergedSchemaCacheKey(params: {
  plugins: PluginUiMetadata[];
  channels: ChannelUiMetadata[];
}): string {
  const plugins = params.plugins
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      configSchema: plugin.configSchema ?? null,
      configUiHints: plugin.configUiHints ?? null,
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const channels = params.channels
    .map((channel) => ({
      id: channel.id,
      label: channel.label,
      description: channel.description,
      configSchema: channel.configSchema ?? null,
      configUiHints: channel.configUiHints ?? null,
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ plugins, channels });
}

function setMergedSchemaCache(key: string, value: ConfigSchemaResponse): void {
  if (mergedSchemaCache.size >= MERGED_SCHEMA_CACHE_MAX) {
    const oldest = mergedSchemaCache.keys().next();
    if (!oldest.done) {
      mergedSchemaCache.delete(oldest.value);
    }
  }
  mergedSchemaCache.set(key, value);
}

function stripChannelSchema(schema: ConfigSchema): ConfigSchema {
  const next = cloneSchema(schema);
  const root = asSchemaObject(next);
  if (!root || !root.properties) {
    return next;
  }
  // Allow `$schema` in config files for editor tooling, but hide it from the
  // Control UI form schema so it does not show up as a configurable section.
  delete root.properties.$schema;
  if (Array.isArray(root.required)) {
    root.required = root.required.filter((key) => key !== "$schema");
  }
  const channelsNode = asSchemaObject(root.properties.channels);
  if (channelsNode) {
    channelsNode.properties = {};
    channelsNode.required = [];
    channelsNode.additionalProperties = true;
  }
  return next;
}

function buildBaseConfigSchema(): ConfigSchemaResponse {
  if (cachedBase) {
    return cachedBase;
  }
  const schema = OpenClawSchema.toJSONSchema({
    target: "draft-07",
    unrepresentable: "any",
  });
  schema.title = "OpenClawConfig";
  const hints = applyDerivedTags(mapSensitivePaths(OpenClawSchema, "", buildBaseHints()));
  const next = {
    schema: stripChannelSchema(schema),
    uiHints: hints,
    version: VERSION,
    generatedAt: new Date().toISOString(),
  };
  cachedBase = next;
  return next;
}

export function buildConfigSchema(params?: {
  plugins?: PluginUiMetadata[];
  channels?: ChannelUiMetadata[];
}): ConfigSchemaResponse {
  const base = buildBaseConfigSchema();
  const plugins = params?.plugins ?? [];
  const channels = params?.channels ?? [];
  if (plugins.length === 0 && channels.length === 0) {
    return base;
  }
  const cacheKey = buildMergedSchemaCacheKey({ plugins, channels });
  const cached = mergedSchemaCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const mergedWithoutSensitiveHints = applyHeartbeatTargetHints(
    applyChannelHints(applyPluginHints(base.uiHints, plugins), channels),
    channels,
  );
  const extensionHintKeys = collectExtensionHintKeys(
    mergedWithoutSensitiveHints,
    plugins,
    channels,
  );
  const mergedHints = applyDerivedTags(
    applySensitiveHints(mergedWithoutSensitiveHints, extensionHintKeys),
  );
  const mergedSchema = applyChannelSchemas(applyPluginSchemas(base.schema, plugins), channels);
  const merged = {
    ...base,
    schema: mergedSchema,
    uiHints: mergedHints,
  };
  setMergedSchemaCache(cacheKey, merged);
  return merged;
}
