import type { Metadata } from "next";
import Footer from "@/components/Footer";
import ImageLightbox from "@/components/ImageLightbox";
import { OpenClawLogo, aiModelLogos, appLogos } from "@/components/logos";

export const metadata: Metadata = {
  title: "OpenClaw桌面版 — 龙虾AI助理，一键安装的全能 AI 助手",
  description:
    "OpenClaw 中文版免费下载。龙虾AI助理 桌面客户端支持 Windows/macOS 一键安装，接入 ChatGPT、Claude、DeepSeek 等 10+ 大模型，Clawdbot/MoltBot 中文版，通过微信钉钉飞书操控 AI。",
  alternates: {
    canonical: "/",
  },
};

const testimonials = [
  {
    name: "张明",
    handle: "产品经理",
    color: "#ef4b58",
    content:
      "用了 OpenClaw 之后，工作效率提升了至少 3 倍。它能自动处理邮件、安排日程，甚至帮我订机票。真正的全能助手！",
  },
  {
    name: "李华",
    handle: "全栈工程师",
    color: "#3b82f6",
    content:
      "让 OpenClaw 帮我管理 GitHub issues、审查代码、自动部署项目。它就像一个永不疲倦的搭档，7x24 待命。",
  },
  {
    name: "王芳",
    handle: "智能家居爱好者",
    color: "#8b5cf6",
    content:
      "把 OpenClaw 接入了家里的智能设备，现在通过微信就能控制灯光、空调、扫地机器人。科技改变生活！",
  },
  {
    name: "陈伟",
    handle: "创业者",
    color: "#10b981",
    content:
      "每天早上自动发送今日待办、天气预报、重要邮件摘要。它比任何 App 都懂我的需求，已经离不开了。",
  },
];

const aiModels = [
  { name: "OpenAI", models: "GPT-4o / o1", logo: "/logos/openai.svg" },
  { name: "Claude", models: "Opus / Sonnet", logo: "/logos/claude.svg" },
  { name: "Gemini", models: "Pro / Ultra", logo: "/logos/gemini.svg" },
  { name: "DeepSeek", models: "V3 / R1", logo: "/logos/deepseek.svg" },
  { name: "通义千问", models: "Qwen Max", logo: "/logos/qwen.svg" },
  { name: "豆包", models: "Doubao Pro", logo: "/logos/doubao.svg" },
  { name: "Moonshot", models: "Kimi", logo: "/logos/moonshot.svg" },
  { name: "智谱", models: "GLM-4", logo: "/logos/zhipu.svg" },
  { name: "文心一言", models: "ERNIE 4.0", logo: "/logos/ernie.svg" },
  { name: "Minimax", models: "abab6.5", logo: "/logos/minimax.svg" },
];

const worksWithApps = [
  { name: "微信", logo: "/logos/wechat.svg" },
  { name: "Telegram", logo: "/logos/telegram.svg" },
  { name: "Discord", logo: "/logos/discord.svg" },
  { name: "Slack", logo: "/logos/slack.svg" },
  { name: "钉钉", logo: "/logos/dingtalk.svg" },
  { name: "飞书", logo: "/logos/feishu.svg" },
  { name: "企业微信", logo: "/logos/wecom.svg" },
  { name: "GitHub", logo: "/logos/github.svg" },
  { name: "Notion", logo: "/logos/notion.svg" },
  { name: "Gmail", logo: "/logos/gmail.svg" },
  { name: "Calendar", logo: "/logos/calendar.svg" },
  { name: "Spotify", logo: "/logos/spotify.svg" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fafafa]">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#fff0f1] via-[#fff7f7] to-[#fafafa]">
        <div className="relative max-w-4xl mx-auto px-5 pt-10 md:pt-14 pb-8 md:pb-10 text-center">
          {/* Lobster Logo */}
          <div className="w-20 h-20 md:w-24 md:h-24 mx-auto mb-4 animate-float lobster-logo cursor-pointer">
            <OpenClawLogo className="w-full h-full" aria-label="OpenClaw 龙虾AI助理 Logo" />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-[#1a1a2e] mb-1 leading-tight tracking-tight animate-fade-in-up">
            OpenClaw <span className="text-[#ef4b58]">桌面版</span>
          </h1>
          <p
            className="text-[#ef4b58] text-sm md:text-base font-semibold tracking-widest uppercase mb-4 animate-fade-in-up"
            style={{ animationDelay: "0.15s" }}
          >
            龙虾AI助理 — 真正能帮你做事的 AI
          </p>
          <p
            className="text-2xl md:text-3xl max-w-2xl mx-auto mb-5 leading-relaxed font-medium animate-fade-in-up"
            style={{ animationDelay: "0.3s" }}
          >
            一键安装，开箱即用，专为中文用户打造
          </p>

          {/* capability tags */}
          <div
            className="flex flex-wrap justify-center gap-2 md:gap-3 max-w-lg mx-auto mb-6 animate-fade-in-up"
            style={{ animationDelay: "0.4s" }}
          >
            {["收发邮件", "管理日历", "航班值机", "代码审查", "智能家居", "极致安全"].map((tag) => (
              <span
                key={tag}
                className="bg-white/80 backdrop-blur text-[#555] text-sm md:text-base px-3.5 py-1.5 rounded-full border border-gray-200 shadow-sm"
              >
                {tag}
              </span>
            ))}
          </div>

          <p className="text-[#999] text-xs md:text-sm max-w-md mx-auto leading-relaxed mb-6">
            Clawdbot / MoltBot 中文版，通过微信、钉钉、飞书等聊天应用即可操控，100%
            兼容原版功能，为Windows用户定制优化安全保护
          </p>

          {/* Hero CTA */}
          <a
            href="#download"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-[#ef4b58] to-[#ff7079] text-white text-base md:text-lg font-bold px-8 py-3.5 rounded-full shadow-lg shadow-[#ef4b58]/20 hover:shadow-xl hover:shadow-[#ef4b58]/30 hover:scale-105 transition-all duration-300"
            aria-label="免费下载 OpenClaw桌面版"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            立即下载
          </a>
        </div>
      </section>

      {/* Download Section */}
      <section
        id="download"
        className="max-w-4xl mx-auto px-5 pt-3 md:pt-5 pb-8 md:pb-10 scroll-mt-4"
        aria-label="OpenClaw 下载"
      >
        <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
          <span className="text-[#ef4b58]">⟩</span> OpenClaw桌面版
        </h2>
        <p className="text-[#999] text-sm md:text-base mb-5">
          选择你的平台，一键安装，30 秒即可开始使用龙虾AI助理
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 md:gap-4 mb-4">
              <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-[#0078d4] to-[#005a9e] rounded-2xl flex items-center justify-center shadow-md shrink-0">
                <svg
                  className="w-6 h-6 md:w-7 md:h-7 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
                </svg>
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">Windows 版</h3>
                <p className="text-[#bbb] text-xs md:text-sm">
                  OpenClaw Windows 安装，支持 Win 10 / 11
                </p>
              </div>
            </div>
            <a
              href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.2.8_x64-setup.exe"
              className="w-full block text-center bg-gradient-to-r from-[#0078d4] to-[#005a9e] text-white py-3 rounded-xl text-sm font-medium shadow-md hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
            >
              下载 Windows 版 (v0.2.8)
            </a>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 md:gap-4 mb-4">
              <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-[#555] to-[#222] rounded-2xl flex items-center justify-center shadow-md shrink-0">
                <svg
                  className="w-6 h-6 md:w-7 md:h-7 text-white"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">macOS 版</h3>
                <p className="text-[#bbb] text-xs md:text-sm">
                  支持 Apple Silicon (M1/M2/M3) 和 Intel
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <a
                href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.2.8_aarch64.dmg"
                className="w-full block text-center bg-gradient-to-r from-[#555] to-[#333] text-white py-3 rounded-xl text-sm font-medium shadow-md hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
              >
                下载 macOS 版 - Apple Silicon (v0.2.8)
              </a>
              <a
                href="https://cdn.openclawcn.net/update/artifacts/OpenClaw桌面版_0.2.8_x64.dmg"
                className="w-full block text-center bg-gradient-to-r from-[#555] to-[#333] text-white py-2.5 rounded-xl text-sm font-medium shadow-sm hover:shadow-md hover:scale-[1.02] transition-all duration-200"
              >
                下载 macOS 版 - Intel (v0.2.8)
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* AI Models Section */}
      <section
        className="bg-gradient-to-b from-[#fff0f1] to-[#fafafa] py-8 md:py-10"
        aria-label="AI 大模型接入"
      >
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
            <span className="text-[#ef4b58]">⟩</span> 一站式接入全球 AI 大模型
          </h2>
          <p className="text-[#999] text-sm md:text-base mb-5">
            OpenClaw 配置简单，无需逐个注册，统一接口调用，价格低至官方{" "}
            <span className="text-[#ef4b58] font-bold">1/3</span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 md:gap-3 mb-6 md:mb-8">
            {aiModels.map((ai, i) => {
              const Logo = aiModelLogos[ai.logo];
              return (
                <div
                  key={i}
                  className="bg-white border border-gray-100 rounded-xl px-3 py-3 md:px-4 md:py-4 text-center shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex flex-col items-center gap-1.5 md:gap-2"
                >
                  {Logo && <Logo className="w-8 h-8 md:w-9 md:h-9 rounded-lg" aria-hidden="true" />}
                  <div>
                    <p className="text-[#1a1a2e] font-semibold text-xs md:text-sm">{ai.name}</p>
                    <p className="text-[#bbb] text-[10px] md:text-xs mt-0.5">{ai.models}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-[#ef4b58] to-[#ff7079] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                  <svg
                    className="w-5 h-5 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">统一接口</h3>
              </div>
              <p className="text-[#666] text-sm leading-relaxed">
                一套 API 通吃所有主流大模型，零适配成本，开箱即用。
              </p>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-[#f59e0b] to-[#d97706] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                  <svg
                    className="w-5 h-5 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">省钱到家</h3>
              </div>
              <p className="text-[#666] text-sm leading-relaxed">
                规模采购 + 智能路由，同等效果成本砍掉 2/3。
              </p>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-[#8b5cf6] to-[#7c3aed] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                  <svg
                    className="w-5 h-5 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                    <line x1="4" y1="4" x2="9" y2="9" />
                  </svg>
                </div>
                <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">一键切换</h3>
              </div>
              <p className="text-[#666] text-sm leading-relaxed">
                不满意？秒切其他模型，零代码改动，找到最优解。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="max-w-4xl mx-auto px-5 py-8 md:py-10" aria-label="安全保障">
        <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
          <span className="text-[#ef4b58]">⟩</span> 你的数据，你做主
        </h2>
        <p className="text-[#999] text-sm md:text-base mb-5">
          OpenClaw桌面版新增命令授权与目录访问控制，AI 再强也在你掌控之中
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
          <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-[#10b981] to-[#059669] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                <svg
                  className="w-5 h-5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">命令级授权</h3>
            </div>
            <p className="text-[#666] text-sm leading-relaxed">
              每条系统命令均需你明确授权。支持白名单/黑名单，杜绝一切越权操作。
            </p>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 md:p-6 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 md:w-11 md:h-11 bg-gradient-to-br from-[#3b82f6] to-[#2563eb] rounded-xl flex items-center justify-center shadow-sm shrink-0">
                <svg
                  className="w-5 h-5 text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                  <line x1="10" y1="12" x2="10" y2="18" />
                  <line x1="14" y1="12" x2="14" y2="18" />
                  <line x1="8" y1="15" x2="16" y2="15" />
                </svg>
              </div>
              <h3 className="text-base md:text-lg font-bold text-[#1a1a2e]">沙盒式文件隔离</h3>
            </div>
            <p className="text-[#666] text-sm leading-relaxed">
              严格限定可访问目录，AI 无法碰你划定的安全线之外的任何文件。
            </p>
          </div>
        </div>
      </section>

      {/* Feature Showcase */}
      <section
        className="bg-gradient-to-b from-[#f0f7ff] to-[#fafafa] py-8 md:py-10"
        aria-label="OpenClaw 教程与配置界面"
      >
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
            <span className="text-[#ef4b58]">⟩</span> 可视化管理，一目了然
          </h2>
          <p className="text-[#999] text-sm md:text-base mb-5">
            告别命令行，OpenClaw 配置全程图形界面，参考教程即可轻松上手
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <ImageLightbox
              src="/images/dashboard.jpg"
              alt="服务状态监控"
              caption="服务状态一目了然，一键启停 AI 助手"
            />
            <ImageLightbox
              src="/images/ai.jpg"
              alt="AI 提供商配置"
              caption="灵活配置多家 AI 提供商，自定义 API 地址"
            />
            <ImageLightbox
              src="/images/feishu.jpg"
              alt="即时通讯连接"
              caption="连接多种聊天平台，打造全渠道 AI 助手"
            />
          </div>
        </div>
      </section>

      {/* Works With Everything */}
      <section className="max-w-4xl mx-auto px-5 py-8 md:py-10" aria-label="集成服务">
        <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
          <span className="text-[#ef4b58]">⟩</span> 你在用的，它都能连
        </h2>
        <p className="text-[#999] text-sm md:text-base mb-5">
          OpenClaw桌面版与 12+ 主流应用和服务无缝集成
        </p>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
          {worksWithApps.map((app, i) => {
            const Logo = appLogos[app.logo];
            return (
              <div
                key={i}
                className="bg-white border border-gray-100 rounded-2xl p-3 md:p-4 flex flex-col items-center justify-center shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 aspect-square"
              >
                {Logo && (
                  <Logo className="w-8 h-8 md:w-10 md:h-10 mb-2 md:mb-3" aria-hidden="true" />
                )}
                <span className="text-[#666] text-[10px] md:text-xs text-center font-medium">
                  {app.name}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-gradient-to-b from-[#fef0f1] to-[#fafafa] py-8 md:py-10">
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-1">
            <span className="text-[#ef4b58]">⟩</span> 听听他们怎么说
          </h2>
          <p className="text-[#999] text-sm md:text-base mb-5">来自真实用户的反馈</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {testimonials.map((t, i) => (
              <div
                key={i}
                className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <div className="flex items-center gap-3 mb-2.5">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.name[0]}
                  </div>
                  <div>
                    <p className="text-[#1a1a2e] font-semibold text-sm md:text-base">{t.name}</p>
                    <p className="text-[#bbb] text-xs">{t.handle}</p>
                  </div>
                </div>
                <p className="text-[#555] text-sm leading-relaxed">{`\u201C${t.content}\u201D`}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="max-w-4xl mx-auto px-5 py-10 md:py-14 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-[#1a1a2e] mb-3">准备好了吗？</h2>
        <p className="text-[#888] text-sm md:text-base mb-6 max-w-md mx-auto">
          加入已在使用 OpenClaw 中文版的用户，让龙虾AI助理 真正为你分担工作
        </p>
        <a
          href="#download"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-[#ef4b58] to-[#ff7079] text-white text-base md:text-lg font-bold px-8 py-3.5 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300"
          aria-label="免费下载 OpenClaw"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          免费下载
        </a>
      </section>

      {/* FAQ Section for SEO */}
      <section className="max-w-4xl mx-auto px-5 pb-8 md:pb-10" aria-label="常见问题">
        <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e] mb-5">
          <span className="text-[#ef4b58]">⟩</span> 常见问题
        </h2>
        <div className="space-y-4">
          <details className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm group">
            <summary className="font-semibold text-[#1a1a2e] cursor-pointer text-sm md:text-base">
              OpenClaw桌面版和原版有什么区别？
            </summary>
            <p className="text-[#666] text-sm leading-relaxed mt-3">
              OpenClaw桌面版（龙虾AI助理）100% 兼容原版 OpenClaw
              全部功能，同时提供图形化安装界面，无需命令行操作。针对中文用户深度优化：中文界面、中文文档教程、国内大模型接入（DeepSeek、通义千问、文心一言等）、更低的
              API 价格，以及微信/钉钉/飞书等国内平台的集成支持。
            </p>
          </details>
          <details className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm group">
            <summary className="font-semibold text-[#1a1a2e] cursor-pointer text-sm md:text-base">
              OpenClaw桌面版安装需要什么条件？
            </summary>
            <p className="text-[#666] text-sm leading-relaxed mt-3">
              OpenClaw桌面版支持 Windows 10 及以上系统和 macOS 12
              及以上版本，一键安装无需任何开发环境。下载对应平台的安装包后双击运行，30
              秒即可完成配置，开始使用全部 AI 功能。
            </p>
          </details>
          <details className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm group">
            <summary className="font-semibold text-[#1a1a2e] cursor-pointer text-sm md:text-base">
              OpenClaw 和 Clawdbot、MoltBot 是什么关系？
            </summary>
            <p className="text-[#666] text-sm leading-relaxed mt-3">
              Clawdbot 和 MoltBot 是 OpenClaw
              的曾用名，它们是同一个产品在不同发展阶段的名称。现在统一使用 OpenClaw
              作为正式名称，OpenClaw
              中文版（龙虾AI助理）继承了此前全部功能并持续更新，中文用户直接使用龙虾AI助理 即可。
            </p>
          </details>
          <details className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm group">
            <summary className="font-semibold text-[#1a1a2e] cursor-pointer text-sm md:text-base">
              如何查看 OpenClaw 教程和配置指南？
            </summary>
            <p className="text-[#666] text-sm leading-relaxed mt-3">
              OpenClaw桌面版内置图形化配置界面，无需手动编辑配置文件。安装后即可通过可视化面板完成
              AI
              提供商设置、聊天平台对接、安全权限管理等全部配置。我们也在持续完善中文教程文档，帮助你快速上手龙虾AI助理
              的各项功能。
            </p>
          </details>
        </div>
      </section>

      <Footer />
    </main>
  );
}
