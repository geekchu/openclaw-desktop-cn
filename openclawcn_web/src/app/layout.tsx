import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'OpenClaw桌面版 — 真正能帮你做事的 AI | 一键安装，开箱即用',
    template: '%s | OpenClaw 中文版',
  },
  description: 'OpenClaw 中文版桌面客户端，一键安装开箱即用。专为中文用户打造的 AI 助手，接入 ChatGPT、Claude、DeepSeek 等 10+ 全球主流大模型，价格低至官方 1/3。支持 Windows/macOS，通过微信钉钉飞书即可操控，收发邮件、管理日历、代码审查、智能家居一站搞定。',
  keywords: 'OpenClaw中文版,OpenClaw桌面版,OpenClaw一键安装,OpenClaw下载,龙虾AI助理,Clawdbot中文版,MoltBot中文版,OpenClaw Windows安装,OpenClaw配置,OpenClaw教程,AI助手,人工智能,桌面应用,大模型,ChatGPT,Claude,DeepSeek,AI桌面客户端,OpenClaw中国版',
  authors: [{ name: 'OpenClawCN' }],
  creator: 'OpenClawCN',
  publisher: 'OpenClawCN',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'OpenClaw桌面版 — 真正能帮你做事的 AI',
    description: 'OpenClaw 中文版，一键安装开箱即用。接入全球 10+ 主流大模型（ChatGPT/Claude/DeepSeek），价格低至官方 1/3。龙虾AI助理，你的全能桌面助手。',
    type: 'website',
    locale: 'zh_CN',
    siteName: 'OpenClaw 中文版',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenClaw桌面版 — 真正能帮你做事的 AI',
    description: 'OpenClaw 中文版，一键安装开箱即用。龙虾AI助理，接入全球 10+ 大模型，价格低至官方 1/3。',
  },
  alternates: {
    canonical: '/',
  },
  category: 'technology',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#ef4b58',
}

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenClaw桌面版',
    alternateName: ['OpenClaw中文版', '龙虾AI助理', 'Clawdbot中文版', 'MoltBot中文版', 'OpenClaw Desktop'],
    description: 'OpenClaw 中文版桌面客户端，一键安装开箱即用，专为中文用户打造的 AI 助手。接入 ChatGPT、Claude、DeepSeek 等全球主流大模型。',
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Windows 10, Windows 11, macOS 12+',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'CNY',
    },
    featureList: [
      '一键安装，开箱即用',
      '接入 10+ 全球 AI 大模型',
      '支持微信、钉钉、飞书等聊天平台',
      '收发邮件、管理日历、代码审查',
      '智能家居控制',
      '命令级安全授权',
      '沙盒式文件隔离',
      '可视化图形管理界面',
    ],
    inLanguage: 'zh-CN',
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'OpenClaw桌面版和原版有什么区别？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'OpenClaw桌面版（龙虾AI助理）100% 兼容原版 OpenClaw 全部功能，同时提供图形化安装界面，无需命令行操作。针对中文用户深度优化：中文界面、中文文档教程、国内大模型接入（DeepSeek、通义千问、文心一言等）、更低的 API 价格，以及微信/钉钉/飞书等国内平台的集成支持。',
        },
      },
      {
        '@type': 'Question',
        name: 'OpenClaw桌面版安装需要什么条件？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'OpenClaw桌面版支持 Windows 10 及以上系统和 macOS 12 及以上版本，一键安装无需任何开发环境。下载对应平台的安装包后双击运行，30 秒即可完成配置，开始使用全部 AI 功能。',
        },
      },
      {
        '@type': 'Question',
        name: 'OpenClaw 和 Clawdbot、MoltBot 是什么关系？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Clawdbot 和 MoltBot 是 OpenClaw 的曾用名，它们是同一个产品在不同发展阶段的名称。现在统一使用 OpenClaw 作为正式名称，OpenClaw 中文版（龙虾AI助理）继承了此前全部功能并持续更新。',
        },
      },
      {
        '@type': 'Question',
        name: '如何查看 OpenClaw 教程和配置指南？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'OpenClaw桌面版内置图形化配置界面，无需手动编辑配置文件。安装后即可通过可视化面板完成 AI 提供商设置、聊天平台对接、安全权限管理等全部配置。',
        },
      },
    ],
  },
]

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.dicebear.com" />
        <link rel="dns-prefetch" href="https://api.dicebear.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
