---
title: "Diffs"
summary: "供智能体使用的只读 diff 查看器与文件渲染工具（可选插件）"
description: "使用可选的 Diffs 插件，把 before/after 文本或 unified patch 渲染为由 Gateway 托管的 diff 视图、PNG/PDF 文件，或同时输出两者。"
read_when:
  - 你希望智能体以 diff 形式展示代码或文档改动
  - 你需要可用于 Canvas 的查看器链接或可发送的渲染文件
  - 你需要带安全默认值的临时 diff 产物
---

# Diffs

`diffs` 是一个可选插件工具，用于把变更内容转换为供智能体使用的只读 diff 产物。

它支持两种输入方式：

- `before` 与 `after` 文本
- unified `patch`

它可以返回：

- 供 Canvas 展示的 Gateway 查看器 URL
- 供消息发送的渲染文件路径（PNG 或 PDF）
- 一次调用同时返回两种结果

## 快速开始

1. 启用插件。
2. 需要优先在 Canvas 里展示时，使用 `mode: "view"`。
3. 需要把 diff 当文件发送到聊天渠道时，使用 `mode: "file"`。
4. 同时需要查看器和文件时，使用 `mode: "both"`。

## 启用插件

```json5
{
  plugins: {
    entries: {
      diffs: {
        enabled: true,
      },
    },
  },
}
```

## 常见工作流

1. 智能体调用 `diffs`。
2. 智能体读取返回结果中的 `details`。
3. 然后执行以下一种或多种动作：
   - 使用 `canvas present` 打开 `details.viewerUrl`
   - 使用 `message` 的 `path` 或 `filePath` 发送 `details.filePath`
   - 同时执行两者

## 输入示例

Before / after：

```json
{
  "before": "# Hello\n\nOne",
  "after": "# Hello\n\nTwo",
  "path": "docs/example.md",
  "mode": "view"
}
```

Patch：

```json
{
  "patch": "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n",
  "mode": "both"
}
```

## 输入字段

- `before`（`string`）：原始文本。未提供 `patch` 时，必须与 `after` 一起使用。
- `after`（`string`）：更新后的文本。未提供 `patch` 时，必须与 `before` 一起使用。
- `patch`（`string`）：unified diff 文本。与 `before` / `after` 互斥。
- `path`（`string`）：before / after 模式下的显示文件名。
- `lang`（`string`）：before / after 模式下的语言提示。
- `title`（`string`）：查看器标题覆盖值。
- `mode`（`"view" | "file" | "both"`）：输出模式。默认使用插件 `defaults.mode`。
- `theme`（`"light" | "dark"`）：查看器主题。默认使用插件 `defaults.theme`。
- `layout`（`"unified" | "split"`）：diff 布局。默认使用插件 `defaults.layout`。
- `expandUnchanged`（`boolean`）：存在完整上下文时展开未修改区块。仅调用级参数，不是插件默认项。
- `fileFormat`（`"png" | "pdf"`）：渲染文件格式。默认使用插件 `defaults.fileFormat`。
- `fileQuality`（`"standard" | "hq" | "print"`）：PNG 或 PDF 渲染质量预设。
- `fileScale`（`number`）：设备缩放覆盖值（`1` - `4`）。
- `fileMaxWidth`（`number`）：最大渲染宽度（CSS 像素，`640` - `2400`）。
- `ttlSeconds`（`number`）：查看器产物 TTL，默认 1800 秒，最大 21600 秒。
- `baseUrl`（`string`）：查看器 URL 源站覆盖值。必须为 `http` 或 `https`，且不能带 query/hash。

## 输出说明

工具会把结构化元数据返回到 `details` 中。

查看器相关字段：

- `artifactId`
- `viewerUrl`
- `viewerPath`
- `title`
- `expiresAt`
- `inputKind`
- `fileCount`
- `mode`

渲染文件相关字段：

- `filePath`
- `path`
- `fileBytes`
- `fileFormat`
- `fileQuality`
- `fileScale`
- `fileMaxWidth`

模式说明：

- `mode: "view"`：只返回查看器字段。
- `mode: "file"`：只返回文件字段，不创建查看器产物。
- `mode: "both"`：同时返回查看器与文件字段；如果文件渲染失败，查看器仍会返回，并在 `details.fileError` 中说明错误。

## 插件默认值

你可以在 `~/.openclawcn/openclaw.json` 中配置插件级默认值：

```json5
{
  plugins: {
    entries: {
      diffs: {
        enabled: true,
        config: {
          defaults: {
            fontFamily: "Fira Code",
            fontSize: 15,
            lineSpacing: 1.6,
            layout: "unified",
            showLineNumbers: true,
            diffIndicators: "bars",
            wordWrap: true,
            background: true,
            theme: "dark",
            fileFormat: "png",
            fileQuality: "standard",
            fileScale: 2,
            fileMaxWidth: 960,
            mode: "both",
          },
        },
      },
    },
  },
}
```

显式传入的工具参数会覆盖这些默认值。

## 安全配置

- `security.allowRemoteViewer`（`boolean`，默认 `false`）
  - `false`：拒绝来自非回环地址的查看器请求。
  - `true`：若带有有效 token 化路径，则允许远程查看器访问。

示例：

```json5
{
  plugins: {
    entries: {
      diffs: {
        enabled: true,
        config: {
          security: {
            allowRemoteViewer: false,
          },
        },
      },
    },
  },
}
```
