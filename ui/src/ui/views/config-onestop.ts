/**
 * 一站式接入全球AI大模型 — 配置组件
 *
 * 引导用户通过 api.openclawcn.net 获取 API Key，快速接入主流大语言模型。
 */
import { html, nothing } from "lit";
import { renderCustomProviders } from "./config-custom-providers.js";

// ─── Tauri invoke helper ─────────────────────────────────────

function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const t = (window as any).__TAURI_INTERNALS__;
  if (!t) return Promise.reject(new Error("Tauri not available"));
  return t.invoke(cmd, args) as Promise<T>;
}

// ─── 一站式保存逻辑（与自定义接入使用相同的 save_provider 命令）───

const ONESTOP_PROVIDER_NAME = "onestop";
const ONESTOP_BASE_URL = "https://api.openclawcn.net/v1";

/**
 * Save the onestop API key and selected model via the same `save_provider`
 * Tauri command that CustomProvidersView uses.
 */
export async function saveOnestopConfig(apiKey: string, selectedModel: string): Promise<void> {
  const model = ONESTOP_MODELS.find((m) => m.id === selectedModel);
  // Build models array – if a model is selected, include it; otherwise save all models
  const modelsToSave = model
    ? [
        {
          id: model.id,
          name: model.name,
          api: "openai",
          input: ["text", "image"],
          contextWindow: 200000,
          maxTokens: 8192,
          reasoning: false,
          cost: null,
        },
      ]
    : ONESTOP_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        api: "openai",
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 8192,
        reasoning: false,
        cost: null,
      }));

  await invoke("save_provider", {
    provider_name: ONESTOP_PROVIDER_NAME,
    base_url: ONESTOP_BASE_URL,
    api_key: apiKey,
    api_type: "openai",
    models: modelsToSave,
  });

  // If a model was selected, set it as the primary model
  if (selectedModel) {
    const fullId = `${ONESTOP_PROVIDER_NAME}/${selectedModel}`;
    await invoke("set_primary_model", { model_id: fullId });
  }
}

// ─── Tab 状态 ────────────────────────────────────────────────

let _activeTab: "onestop" | "custom" = "onestop";

// ─── 模型定义 ───────────────────────────────────────────────

export type OnestopModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  category: "chat" | "code" | "reasoning" | "vision" | "multimodal";
  badge?: string;
};

const ONESTOP_MODELS: OnestopModel[] = [
  // OpenAI
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    description: "最新多模态旗舰模型，支持文本、图像和音频",
    category: "multimodal",
    badge: "推荐",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    description: "轻量高效模型，适合日常对话和简单任务",
    category: "chat",
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    provider: "OpenAI",
    description: "高级推理模型，擅长数学、编程和逻辑推理",
    category: "reasoning",
    badge: "新",
  },
  // Anthropic
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    description: "平衡性能与速度的对话模型",
    category: "chat",
    badge: "推荐",
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    description: "快速轻量模型，适合实时交互场景",
    category: "chat",
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "Anthropic",
    description: "最强大的 Claude 模型，适合复杂分析和创作",
    category: "reasoning",
  },
  // Google
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    description: "Google 最新多模态模型，支持超长上下文",
    category: "multimodal",
    badge: "新",
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    description: "高速推理模型，平衡质量与效率",
    category: "chat",
  },
  // DeepSeek
  {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    description: "国产高性能模型，中文理解能力出色",
    category: "chat",
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    description: "深度推理模型，数学和逻辑能力突出",
    category: "reasoning",
  },
  // Qwen
  {
    id: "qwen-max",
    name: "通义千问 Max",
    provider: "阿里云",
    description: "阿里最强大语言模型，全面的中文能力",
    category: "chat",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  all: "全部",
  chat: "对话",
  code: "代码",
  reasoning: "推理",
  vision: "视觉",
  multimodal: "多模态",
};

// ─── 组件 Props ────────────────────────────────────────────

export type OnestopProps = {
  apiKey: string;
  selectedModel: string;
  showApiKey: boolean;
  activeCategory: string;
  saving: boolean;
  onApiKeyChange: (value: string) => void;
  onModelSelect: (modelId: string) => void;
  onToggleShowApiKey: () => void;
  onCategoryChange: (cat: string) => void;
  onSave: () => void;
  onNavigateToCustom: () => void;
  requestUpdate: () => void;
};

// ─── SVG Icons ─────────────────────────────────────────────

const icons = {
  rocket: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
    </svg>
  `,
  key: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
    </svg>
  `,
  eye: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `,
  eyeOff: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
      <line x1="2" x2="22" y1="2" y2="22"></line>
    </svg>
  `,
  externalLink: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" x2="21" y1="14" y2="3"></line>
    </svg>
  `,
  check: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `,
  sparkles: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
      <path d="M5 3v4"></path>
      <path d="M19 17v4"></path>
      <path d="M3 5h4"></path>
      <path d="M17 19h4"></path>
    </svg>
  `,
};

// ─── Provider 颜色 ─────────────────────────────────────────

function providerColor(provider: string): string {
  switch (provider) {
    case "OpenAI":
      return "#10a37f";
    case "Anthropic":
      return "#d4a27f";
    case "Google":
      return "#4285f4";
    case "DeepSeek":
      return "#4d6bfe";
    case "阿里云":
      return "#ff6a00";
    default:
      return "#888";
  }
}

// ─── 渲染函数 ───────────────────────────────────────────────

// 缓存一站式内容模板，避免在切换到自定义 Tab 时重复渲染
let _lastOnestopContent: any = null;

export function renderOnestop(props: OnestopProps) {
  // 优化：仅在当前 Tab 为 onestop 时重新执行渲染逻辑
  // 如果是其他 Tab (隐藏状态)，直接使用缓存的模板
  let onestopContent;
  if (_activeTab === "onestop") {
    onestopContent = renderOnestopContent(props);
    _lastOnestopContent = onestopContent;
  } else if (_lastOnestopContent) {
    onestopContent = _lastOnestopContent;
  } else {
    // 首次渲染且非激活状态（例如默认进入 custom tab）
    onestopContent = renderOnestopContent(props);
    _lastOnestopContent = onestopContent;
  }

  return html`
    <div class="onestop">
      <!-- Tab Navigation -->
      <div class="onestop-tabs">
        <button
          class="onestop-tabs__item ${_activeTab === "onestop" ? "active" : ""}"
          @click=${() => {
            _activeTab = "onestop";
            props.requestUpdate();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="onestop-tabs__icon">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
          </svg>
          一站式接入
        </button>
        <button
          class="onestop-tabs__item ${_activeTab === "custom" ? "active" : ""}"
          @click=${() => {
            _activeTab = "custom";
            props.requestUpdate();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="onestop-tabs__icon">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          自定义接入
        </button>
      </div>

      <div style="display: ${_activeTab === "onestop" ? "grid" : "none"}; gap: 24px;">
        ${onestopContent}
      </div>
      <div style="display: ${_activeTab === "custom" ? "block" : "none"}">
        ${renderCustomProviders({
          requestUpdate: props.requestUpdate,
        })}
      </div>
    </div>
  `;
}

// ─── 一站式接入内容 ──────────────────────────────────────────

function renderOnestopContent(props: OnestopProps) {
  const hasApiKey = Boolean(props.apiKey?.trim());
  const filteredModels =
    props.activeCategory === "all"
      ? ONESTOP_MODELS
      : ONESTOP_MODELS.filter((m) => m.category === props.activeCategory);

  const categories = ["all", ...new Set(ONESTOP_MODELS.map((m) => m.category))];

  return html`
      <!-- Hero Banner -->
      <div class="onestop-hero">
        <div class="onestop-hero__glow"></div>
        <div class="onestop-hero__content">
          <div class="onestop-hero__icon">${icons.sparkles}</div>
          <div class="onestop-hero__text">
            <h2 class="onestop-hero__title">一站式接入全球AI大模型</h2>
            <p class="onestop-hero__subtitle">
              只需一个 API Key，即可接入 OpenAI、Claude、Gemini、DeepSeek 等全球主流大语言模型
            </p>
          </div>
          <div class="onestop-hero__status">
            ${
              hasApiKey
                ? html`<span class="onestop-badge onestop-badge--ok">
                    <span class="onestop-badge__dot"></span>
                    已接入
                  </span>`
                : html`<span class="onestop-badge onestop-badge--pending">
                    <span class="onestop-badge__dot"></span>
                    未配置
                  </span>`
            }
          </div>
        </div>
      </div>

      <!-- Step 1: API Key -->
      <div class="onestop-section">
        <div class="onestop-section__header">
          <div class="onestop-section__step">1</div>
          <div class="onestop-section__meta">
            <h3 class="onestop-section__title">获取并填写 API Key</h3>
            <p class="onestop-section__desc">
              前往
              <a
                href="https://api.openclawcn.net"
                target="_blank"
                rel="noopener noreferrer"
                class="onestop-link"
              >
                api.openclawcn.net
                <span class="onestop-link__icon">${icons.externalLink}</span>
              </a>
              注册并申请 API Key
            </p>
          </div>
        </div>
        <div class="onestop-apikey">
          <div class="onestop-apikey__field">
            <div class="onestop-apikey__icon">${icons.key}</div>
            <input
              type=${props.showApiKey ? "text" : "password"}
              class="onestop-apikey__input"
              placeholder="请输入您的 API Key"
              .value=${props.apiKey}
              @input=${(e: Event) =>
                props.onApiKeyChange((e.target as HTMLInputElement).value)}
            />
            <button
              class="onestop-apikey__toggle"
              @click=${props.onToggleShowApiKey}
              title=${props.showApiKey ? "隐藏" : "显示"}
            >
              ${props.showApiKey ? icons.eyeOff : icons.eye}
            </button>
          </div>
          <button
            class="onestop-apikey__save"
            ?disabled=${!hasApiKey || props.saving}
            @click=${props.onSave}
          >
            ${props.saving ? "保存中…" : hasApiKey ? "保存 API Key" : "请先填写 API Key"}
          </button>
        </div>
      </div>

      <!-- Step 2: Model Selection -->
      <div class="onestop-section">
        <div class="onestop-section__header">
          <div class="onestop-section__step">2</div>
          <div class="onestop-section__meta">
            <h3 class="onestop-section__title">选择AI模型</h3>
            <p class="onestop-section__desc">
              选择您想使用的默认模型，所有模型均通过统一 API 接入
            </p>
          </div>
        </div>

        <!-- Category filter -->
        <div class="onestop-categories">
          ${categories.map(
            (cat) => html`
              <button
                class="onestop-categories__item ${props.activeCategory === cat ? "active" : ""}"
                @click=${() => props.onCategoryChange(cat)}
              >
                ${CATEGORY_LABELS[cat] ?? cat}
              </button>
            `,
          )}
        </div>

        <!-- Model Grid -->
        <div class="onestop-models">
          ${filteredModels.map(
            (model) => html`
              <button
                class="onestop-model-card ${props.selectedModel === model.id ? "selected" : ""}"
                style="border-left-color: ${props.selectedModel === model.id ? '#8b5cf6' : providerColor(model.provider)}"
                @click=${() => props.onModelSelect(model.id)}
              >
                <div class="onestop-model-card__header">
                  <span
                    class="onestop-model-card__provider"
                    style="color: ${providerColor(model.provider)}"
                  >
                    ${model.provider}
                  </span>
                  ${
                    model.badge
                      ? html`<span class="onestop-model-card__badge">${model.badge}</span>`
                      : nothing
                  }
                  ${
                    props.selectedModel === model.id
                      ? html`<span class="onestop-model-card__check">${icons.check}</span>`
                      : nothing
                  }
                </div>
                <div class="onestop-model-card__name">${model.name}</div>
                <div class="onestop-model-card__desc">${model.description}</div>
                <div class="onestop-model-card__category">
                  ${CATEGORY_LABELS[model.category] ?? model.category}
                </div>
              </button>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}
