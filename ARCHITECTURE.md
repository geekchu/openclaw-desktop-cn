# OpenClaw Desktop CN 架构笔记

这份文档是面向开发者的仓内速查版，目标不是替代官方文档，而是帮助我在改代码时快速回答 4 个问题：

1. 这个项目的主进程到底是谁。
2. 一条消息从哪里进、在哪里路由、最后从哪里出。
3. CLI、Web UI、Tauri 桌面壳分别扮演什么角色。
4. 我改完代码后，真正被运行的是哪份产物。

## 1. 项目一句话概括

`openclaw` 的核心是一个 **Gateway 控制平面**：

- 它维护消息通道连接。
- 它提供 HTTP + WebSocket 接口。
- CLI、Web UI、桌面端、节点设备都围绕它工作。
- 绝大多数“用户可见能力”本质上都是通过 Gateway 暴露出来的。

可以把它理解成：

- **Gateway = 后端中枢 / 控制平面**
- **CLI = 管理入口 + 本地操作入口**
- **UI = 控制台前端**
- **Tauri = 桌面外壳 + Gateway 子进程管理器**
- **extensions = 可插拔通道/能力扩展**

## 2. 仓库分层

### 2.1 顶层目录

- `src/`：主 TypeScript 代码，CLI、Gateway、路由、消息通道、Agent、配置、基础设施都在这里。
- `ui/`：控制台前端 workspace，构建产物进入 `dist/control-ui/`。
- `src-tauri/`：桌面端壳层，负责托盘、窗口、自动更新、启动/停止 Gateway 子进程。
- `extensions/`：插件式扩展，包含通道扩展和能力扩展。
- `packages/`：共享 workspace 包。
- `docs/`：对外文档；这里已经有官方概念文档，但不完全等于仓内开发视角。
- `dist/`：主 TypeScript 构建产物。

### 2.2 workspace 关系

`pnpm-workspace.yaml` 把这几个部分组织成 monorepo：

- 根包 `.`
- `ui`
- `packages/*`
- `extensions/*`

所以这不是“单一 Node 项目 + 一个前端目录”，而是 **一个以根包为核心的多包仓库**。

## 3. 运行时总览

### 3.1 高层结构

```text
消息通道 / 插件 / 设备节点
          │
          ▼
   ┌──────────────────┐
   │     Gateway      │
   │ HTTP + WebSocket │
   │   路由 / 会话     │
   │ Agent / 事件总线  │
   └────────┬─────────┘
            │
   ┌────────┼───────────────┬───────────────┐
   │        │               │               │
   ▼        ▼               ▼               ▼
 CLI     Web UI          ACP/Agent       Tauri Desktop
```

### 3.2 谁是“主进程”

分两种运行形态：

1. **CLI / Node 直跑**
   - 入口是 `openclaw.mjs`
   - 它先做 Node 版本校验，再加载 `dist/entry.js` 或 `dist/entry.mjs`
   - 这时主进程就是 Node + Gateway/CLI 运行时

2. **桌面端运行**
   - 主进程是 `src-tauri/` 的 Rust 应用
   - Rust 壳层负责拉起一个 Node 子进程执行 `openclaw`
   - 真正的业务仍然在 Gateway 里，只是被桌面壳托管

结论：

- **产品能力主脑是 Gateway**
- **桌面版只是宿主，不是业务核心**

## 4. 核心模块地图

### 4.1 启动与 CLI

- `openclaw.mjs`
  - CLI 启动入口。
  - 负责 Node 版本校验、加载 `dist/entry.*`。
- `src/index.ts`
  - Node 运行时总入口。
  - 会加载环境变量、装配默认依赖、建立 CLI program。
- `src/cli/`
  - CLI 相关装配。
  - `deps.ts` 里的 `createDefaultDeps()` 是一个重要装配点。
- `src/commands/`
  - 各个命令的实现。
  - 可以理解为“CLI 的 application service 层”。

理解方式：

- `src/index.ts` 更像组合根（composition root）。
- `src/commands/*` 才是实际的业务动作落点。

### 4.2 Gateway 控制平面

- `src/gateway/server.ts`
  - 暴露 Gateway server 启动入口。
- `src/gateway/server.impl.ts`
  - 真正的服务实现核心。
- `src/gateway/client.ts`
  - Gateway 客户端封装。
  - CLI、ACP、其他客户端通过它走 WS 协议。

Gateway 的职责大致有 5 类：

1. 接入 HTTP/WS
2. 完成 connect 握手与认证
3. 暴露 method/event 风格协议
4. 管理会话、状态、健康检查、事件推送
5. 串联通道、Agent、节点能力

它是整个系统的中心枢纽。

### 4.3 配置层

- `src/config/`
  - 配置加载、schema、session store、帮助文本等。
- `src/config/schema.ts`
  - 配置字段非常多，是理解能力面的重要索引文件。

这层可以理解成：

- **运行时行为开关中心**
- **通道、模型、路由、网关行为的统一配置入口**

### 4.4 通道与消息入口

通道相关代码是分层的，不是所有通道都直接平铺在一个目录。

常见相关目录：

- `src/channels/`：通道抽象、注册表、allowlist、gating、状态、线程绑定等通用逻辑。
- `src/web/`：Web/WhatsApp 相关实现。
- `src/telegram/`、`src/discord/`、`src/slack/`、`src/signal/`、`src/imessage/`：内建通道实现。
- `extensions/*`：插件通道，例如 Matrix、Teams、Zalo 等。

关键理解：

- **通道实现负责接入外部世界**。
- **`src/channels/` 负责共享规则与抽象**。
- **扩展通道和内建通道都要汇入同一个 Gateway/路由体系**。

### 4.5 路由与会话绑定

- `src/routing/resolve-route.ts`
- `src/routing/session-key.ts`

这是项目里很重要、但第一次读容易忽略的层。

它解决的问题不是“HTTP 路由”，而是：

- 一条消息属于哪个会话。
- 同一个人/群/线程如何映射到内部 `sessionKey`。
- Agent 应该复用哪个上下文。
- 多通道/多账号情况下如何维持一致的会话语义。

可以把这一层理解成：

- **消息世界 -> OpenClaw 内部会话世界** 的翻译器。

### 4.6 Agent / ACP 层

- `src/acp/`
  - 这是另一条重要主线。
  - 可以把它看作“Agent 控制协议适配层”。
- `src/acp/server.ts`
  - 对外提供 ACP Gateway 服务。
- `src/acp/translator.ts`
  - 把 ACP 会话/事件/调用翻译到 Gateway 会话和事件。
- `src/agents/`
  - 更偏 Agent 相关能力、模型接入、运行时辅助。

我的理解是：

- Gateway 是系统总线。
- ACP 是面向 Agent 运行时/控制流的一套桥接层。
- `translator` 是协议翻译器，把 ACP 会话动作映射到 Gateway 的 session/chat/agent 操作。

### 4.7 媒体与基础设施

- `src/media/`：媒体处理流水线。
- `src/infra/`：运行时守卫、环境、二进制、端口、错误处理等基础设施。
- `src/process/`：命令执行等能力。

这些目录不直接承载“产品入口”，但它们决定了系统是否稳定可运行。

## 5. 一条消息的主路径

下面是最值得记住的主链路：

```text
外部消息
  -> 通道接入层
  -> 通道通用规则 / allowlist / gating
  -> routing 解析 sessionKey
  -> Gateway 内部会话 / Agent 调用
  -> 产出回复或动作
  -> 通道 outbound 发送回外部世界
```

展开后通常会包含这些阶段：

1. **接入**
   - 某个 channel adapter 收到消息。
2. **标准化**
   - 提取发送者、目标、线程、媒体、消息文本。
3. **准入控制**
   - allowlist、命令 gating、群聊策略、提及策略。
4. **会话绑定**
   - 通过 routing 生成或复用 `sessionKey`。
5. **Agent/模型处理**
   - 进入 chat/agent 流程，可能流式返回。
6. **下游动作**
   - 回复消息、发送媒体、调用节点命令、更新状态。
7. **事件传播**
   - 通过 Gateway WS 事件把状态同步到 CLI/UI/节点。

这也是排查问题时最实用的拆分方法：

- 是接入错了？
- 是规则拦了？
- 是 session 绑错了？
- 是 Agent 没返回？
- 是 outbound 发不出去？

## 6. WebSocket 协议在系统中的位置

这个项目不是“CLI 直接操作消息通道”的简单架构，而是明显偏 **控制平面** 设计。

WebSocket 协议承担的是统一控制面：

- 客户端先 `connect`
- 然后用 `req/res/event` 模式通信
- Gateway 对外广播健康状态、会话事件、Agent 流式输出等

因此：

- CLI 不只是本地命令行，也是在很多场景下充当 Gateway client。
- Web UI 不是另一个后端，而是 Gateway 的控制台。
- 节点设备也不是“旁路系统”，而是通过同一 WS 网络接入。

## 7. 前端与桌面壳

### 7.1 Web UI

- `ui/` 是独立 workspace。
- Tauri 配置把前端产物指向 `dist/control-ui/`。
- 所以前端更新后，桌面窗口实际加载的是构建后的控制台静态文件。

前端不是业务核心，但它直接体现系统的可观测性与可操作性。

### 7.2 Tauri 桌面层

`src-tauri/` 的职责非常明确：

- 创建桌面窗口和托盘
- 管理自动启动、自动更新、通知
- 管理 Gateway 子进程生命周期
- 处理桌面环境下 Node/runtime/path 的差异

关键点：

- `src-tauri/src/main.rs`
  - 设置 `OPENCLAW_GATEWAY_BUNDLE_DIR`
  - 初始化托盘、窗口、插件
  - 创建 `GatewayManager`
- `src-tauri/src/gateway.rs`
  - 启动、停止、健康检查 Gateway 子进程
- `src-tauri/src/utils/shell.rs`
  - 决定实际用哪个 Node、哪个入口文件、哪个工作目录运行 `openclaw`

### 7.3 桌面版不是直接“嵌入业务代码”

桌面版实际上是：

```text
Tauri Rust 壳
  -> 选择 Node runtime
  -> 选择 openclaw 入口
  -> 启动 Node 子进程
  -> 轮询 Gateway 是否 ready
  -> 前端页面再去访问本地 Gateway
```

所以桌面问题经常分成两类：

- 壳层问题：窗口、托盘、进程启动、PATH、Node 找不到
- 业务问题：Gateway 自己启动了，但通道/配置/协议出错

## 8. 构建产物与“改了代码为什么没生效”

这是这个仓库最容易踩坑的地方之一。

### 8.1 Node/CLI 形态

- `openclaw.mjs` 读取的是根目录 `dist/entry.js` 或 `dist/entry.mjs`
- 所以 **CLI 直跑时**，根目录 `dist/` 就是关键产物

### 8.2 UI 形态

- `ui/` 构建后进入 `dist/control-ui/`
- Tauri 的 `frontendDist` 指向它

### 8.3 Tauri 打包形态

生产打包前，`src-tauri/tauri.conf.json` 会执行：

- `node scripts/prepare-gateway-bundle.js`

这个脚本会把桌面端运行所需的内容整理到：

- `src-tauri/gateway-bundle/`

里面不只是 `dist/`，还包括：

- `openclaw.mjs`
- `package.json`
- `assets/`
- `skills/`
- `extensions/`
- 必需的 `node_modules/`

也就是说：

- **根目录 `dist/` 是源码编译产物**
- **`src-tauri/gateway-bundle/` 是桌面分发时真正要跑的 bundle 形态**

如果是打包桌面版或排查桌面分发问题，只修根目录 `dist/` 往往不够，还要看 bundle 是否同步。

### 8.4 当前代码下的开发/生产差异

按 `src-tauri/src/main.rs` 当前实现：

- **debug/dev**：`OPENCLAW_GATEWAY_BUNDLE_DIR` 指向项目根目录
- **release/production**：指向 Tauri `resource_dir` 下的 `gateway-bundle/`

按 `src-tauri/src/utils/shell.rs` 当前实现：

- 如果存在 `OPENCLAW_GATEWAY_BUNDLE_DIR` 且能找到 `openclaw.mjs` / `dist/entry.js`
  - 优先以 bundle 模式启动
- release 下如果 bundle 不完整
  - 不会优雅回退到系统 `openclaw`

所以我的排查顺序应该是：

1. 先确认当前是 CLI、Tauri debug、还是 Tauri release。
2. 再确认实际入口文件和工作目录。
3. 最后判断该看根 `dist/` 还是 `gateway-bundle/`。

## 9. 插件与扩展机制

`extensions/*` 说明这个系统不是把所有通道写死在主包里。

插件层的意义：

- 增加新的消息通道
- 提供额外能力
- 在不污染核心包的前提下扩展生态

从打包脚本可以看出，桌面 bundle 会主动合并 extension 的运行时依赖，这说明：

- extension 不是纯源码示例，
- 而是实际运行时的一等公民。

理解这个点很重要，因为很多“通道相关改动”并不只在 `src/telegram` / `src/web` 里，还可能牵涉 `extensions/*`。

## 10. 配置、状态与本地数据

运行时真正依赖的不只是代码，还有本地状态：

- 配置文件
- 凭据
- session store
- 通道登录状态
- pairing / device trust

对桌面端来说，Rust 壳还会注入一些运行时环境变量，例如：

- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_DESKTOP=1`
- `OPENCLAW_STATE_DIR`
- `OPENCLAW_GATEWAY_BUNDLE_DIR`

所以很多“我明明能在命令行跑起来，为什么桌面版不行”的问题，本质上是：

- 工作目录不同
- 环境变量不同
- Node/runtime 来源不同
- 配置目录不同

## 11. 推荐的读码顺序

如果下次重新上手，我会按这个顺序读：

1. `package.json`
   - 看 scripts、build 链、测试链。
2. `openclaw.mjs`
   - 看 CLI 最外层入口。
3. `src/index.ts`
   - 看 Node 运行时组合根。
4. `src/gateway/server.ts` + `src/gateway/server.impl.ts`
   - 看系统中心。
5. `src/gateway/client.ts`
   - 看客户端如何接 Gateway。
6. `src/config/schema.ts`
   - 看系统能力面和配置面。
7. `src/routing/resolve-route.ts`
   - 看会话绑定规则。
8. `src/channels/` + 某个具体通道实现
   - 看消息接入/发出路径。
9. `src/acp/`
   - 看 Agent 控制协议桥接。
10. `src-tauri/src/main.rs` + `src-tauri/src/utils/shell.rs`

- 看桌面壳如何启动实际运行时。

## 12. 我对这套架构的总结

如果只记一句话，我会记这个：

> 这是一个以 Gateway 为中心、以 WebSocket 为控制面、以通道/会话/Agent 为核心领域对象、并由 CLI/UI/Tauri 共同消费的多入口系统。

换成更工程化的说法：

- **核心域**：通道、会话、路由、Agent、节点能力
- **应用层**：CLI commands、Gateway methods/events、ACP translator
- **适配层**：各类 channel adapter、UI、Tauri shell、插件
- **基础设施层**：配置、环境、媒体、端口、进程、二进制管理

这也是我后续改动时的分层原则：

- 改协议/状态同步，优先看 Gateway。
- 改消息归属/串话问题，优先看 routing/session-key。
- 改通道行为，先看 shared channel logic，再看具体 channel。
- 改桌面启动/打包问题，优先看 Tauri + bundle 逻辑。
- 改“看起来像前端问题”的现象，也别忘了背后通常还是 Gateway 状态问题。
