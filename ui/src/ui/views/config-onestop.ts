/**
 * 一站式接入全球AI大模型 — 配置组件
 *
 * 从 api.openclawcn.net 动态获取可用模型列表，引导用户快速接入。
 */
import { html, nothing } from "lit";
import { renderCustomProviders } from "./config-custom-providers.js";

// ─── Tauri invoke helper ─────────────────────────────────────

function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = (window as any).__TAURI__;
  if (t?.core?.invoke) {
    return t.core.invoke(cmd, args) as Promise<T>;
  }
  return Promise.reject(new Error("Tauri invoke not available"));
}

// ─── 一站式保存逻辑 ───────────────────────────────────────────

const ONESTOP_PROVIDER_NAME = "onestop";
const ONESTOP_BASE_URL = "https://api.openclawcn.net/v1";
const MODELS_API_URL = "https://api.openclawcn.net/v1/models";
const PRICING_URL = "https://api.openclawcn.net/pricing";

/**
 * Save the onestop API key and selected model.
 * Uses a single get_config → modify → save_config cycle to minimize file writes.
 */
export async function saveOnestopConfig(apiKey: string, selectedModel: string): Promise<void> {
  // 只保存选中的模型到配置，不保存全部缓存模型（避免配置膨胀）
  let modelsToSave: OnestopModel[] = [];
  if (selectedModel) {
    const found = _cachedModels.find((m) => m.id === selectedModel);
    modelsToSave = found
      ? [found]
      : [
          {
            id: selectedModel,
            name: formatModelName(selectedModel),
            provider: inferProvider(selectedModel).name,
            providerKey: inferProvider(selectedModel).key,
          },
        ];
  }

  // 单次原子写入：get_config → 修改全部字段 → save_config
  // 避免多次写文件触发 gateway 的文件监视器反复重启
  const cfg = await invoke<Record<string, any>>("get_config");

  // 1. 设置 provider 配置 (models.providers.onestop)
  if (!cfg.models) cfg.models = {};
  if (!cfg.models.providers) cfg.models.providers = {};
  cfg.models.providers[ONESTOP_PROVIDER_NAME] = {
    baseUrl: ONESTOP_BASE_URL,
    // 如果用户未输入新 Key，保留配置文件中已有的 Key
    apiKey: apiKey || cfg.models.providers?.[ONESTOP_PROVIDER_NAME]?.apiKey || "",
    models: modelsToSave.map((m) => ({
      id: m.id,
      name: m.name,
      api: "openai-completions",
      input: ["text", "image"],
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  };

  // 2. 注册模型到 agents.defaults.models
  if (!cfg.agents) cfg.agents = {};
  if (!cfg.agents.defaults) cfg.agents.defaults = {};
  if (!cfg.agents.defaults.models) cfg.agents.defaults.models = {};

  // 先清理该 provider 下的旧模型
  const prefix = `${ONESTOP_PROVIDER_NAME}/`;
  for (const key of Object.keys(cfg.agents.defaults.models)) {
    if (key.startsWith(prefix)) {
      delete cfg.agents.defaults.models[key];
    }
  }
  // 添加当前选中的模型
  for (const m of modelsToSave) {
    cfg.agents.defaults.models[`${ONESTOP_PROVIDER_NAME}/${m.id}`] = {};
  }

  // 3. 设置主模型
  if (selectedModel) {
    const fullId = `${ONESTOP_PROVIDER_NAME}/${selectedModel}`;
    if (!cfg.agents.defaults.model) cfg.agents.defaults.model = {};
    cfg.agents.defaults.model.primary = fullId;
  }

  // 更新元数据
  if (!cfg.meta) cfg.meta = {};
  cfg.meta.lastTouchedAt = new Date().toISOString();

  // 单次写入
  await invoke("save_config", { config: cfg });
}

// ─── 测试连接 ─────────────────────────────────────────────────

let _testing = false;
let _testResult: { success: boolean; message: string } | null = null;

async function testOnestopConnection(requestUpdate: () => void) {
  _testing = true;
  _testResult = null;
  requestUpdate();

  try {
    const result = await invoke<{
      success: boolean;
      provider: string;
      model: string;
      response: string | null;
      error: string | null;
      latency_ms: number | null;
    }>("test_ai_connection");

    _testResult = {
      success: result.success,
      message: result.success
        ? `✓ 连接成功 — ${result.model}${result.latency_ms ? ` (${result.latency_ms}ms)` : ""}`
        : `✗ 连接失败: ${result.error || "未知错误"}`,
    };
  } catch (e) {
    _testResult = {
      success: false,
      message: `✗ 测试失败: ${String(e)}`,
    };
  } finally {
    _testing = false;
    requestUpdate();
    // 10 秒后自动隐藏测试结果
    setTimeout(() => {
      _testResult = null;
      requestUpdate();
    }, 10_000);
  }
}

// ─── 保存结果反馈 ──────────────────────────────────────────────

let _saveResult: { success: boolean; message: string } | null = null;
let _saveResultTimer: ReturnType<typeof setTimeout> | null = null;

function showSaveResult(success: boolean, message: string, requestUpdate: () => void) {
  if (_saveResultTimer) clearTimeout(_saveResultTimer);
  _saveResult = { success, message };
  requestUpdate();
  _saveResultTimer = setTimeout(() => {
    _saveResult = null;
    requestUpdate();
  }, 4000);
}

// ─── Tab 状态 ────────────────────────────────────────────────

let _activeTab: "onestop" | "custom" = "onestop";

// 自定义接入设置的主模型（用于状态栏显示）
let _customPrimaryModel: string | null = null;
let _customPrimaryListenerAdded = false;
let _latestRequestUpdate: (() => void) | null = null;

// 已保存的 API Key 脱敏显示
let _existingMaskedKey: string | null = null;
let _existingKeyLoaded = false;
let _existingKeyLoadPromise: Promise<void> | null = null;

/** 从配置文件加载已有的 onestop API Key 并脱敏 */
function loadExistingApiKey(requestUpdate: () => void): void {
  if (_existingKeyLoaded || _existingKeyLoadPromise) return;
  _existingKeyLoadPromise = (async () => {
    try {
      const cfg = await invoke<Record<string, any>>("get_config");
      const apiKey = cfg?.models?.providers?.onestop?.apiKey;
      if (typeof apiKey === "string" && apiKey.length > 0) {
        // 脱敏显示：前4后4，中间用 • 填充
        if (apiKey.length > 8) {
          _existingMaskedKey = `${apiKey.slice(0, 4)}${"•".repeat(Math.min(apiKey.length - 8, 20))}${apiKey.slice(-4)}`;
        } else {
          _existingMaskedKey = "•".repeat(apiKey.length);
        }
      }
    } catch {
      // 配置不可用时忽略
    } finally {
      _existingKeyLoaded = true;
      _existingKeyLoadPromise = null;
      requestUpdate();
    }
  })();
}

// ─── 动态模型获取 ─────────────────────────────────────────────

export type OnestopModel = {
  id: string;
  name: string;
  provider: string;
  providerKey: string; // 用于匹配 Logo 和颜色
};

let _cachedModels: OnestopModel[] = [];
let _modelsLoading = false;
let _modelsError: string | null = null;
let _fetchPromise: Promise<void> | null = null;

/** 从模型 ID 推断 Provider */
function inferProvider(modelId: string): { name: string; key: string } {
  const id = modelId.toLowerCase();
  if (id.startsWith("deepseek")) return { name: "DeepSeek", key: "deepseek" };
  if (id.startsWith("doubao") || id.startsWith("seed")) return { name: "豆包", key: "doubao" };
  if (id.startsWith("glm")) return { name: "智谱 GLM", key: "glm" };
  if (id.startsWith("hunyuan") || id.startsWith("tencent"))
    return { name: "腾讯混元", key: "hunyuan" };
  if (id.startsWith("kimi")) return { name: "Kimi", key: "kimi" };
  if (id.startsWith("longcat")) return { name: "Longcat", key: "longcat" };
  if (id.startsWith("mimo")) return { name: "Mimo", key: "mimo" };
  if (id.startsWith("minimax")) return { name: "MiniMax", key: "minimax" };
  if (id.startsWith("qwen")) return { name: "通义千问", key: "qwen" };
  if (id.startsWith("gpt") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4"))
    return { name: "OpenAI", key: "openai" };
  if (id.startsWith("claude")) return { name: "Anthropic", key: "anthropic" };
  if (id.startsWith("gemini")) return { name: "Google", key: "google" };
  return { name: modelId.split("-")[0] || "其他", key: "other" };
}

/** 将模型 ID 转为可读的显示名称 */
function formatModelName(id: string): string {
  // 去掉 provider 前缀，美化显示
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\bLatest\b/i, "Latest")
    .replace(/\bPlus\b/i, "Plus")
    .trim();
}

/** 获取模型列表 */
export function fetchModels(requestUpdate: () => void): void {
  if (_cachedModels.length > 0 || _modelsLoading) return;
  if (_fetchPromise) return;

  _modelsLoading = true;
  _modelsError = null;

  _fetchPromise = fetch(MODELS_API_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: { data: Array<{ id: string; owned_by?: string }> }) => {
      _cachedModels = data.data.map((m) => {
        const p = inferProvider(m.id);
        return {
          id: m.id,
          name: formatModelName(m.id),
          provider: p.name,
          providerKey: p.key,
        };
      });
      _modelsLoading = false;
      _fetchPromise = null;
      requestUpdate();
    })
    .catch((err) => {
      _modelsError = String(err);
      _modelsLoading = false;
      _fetchPromise = null;
      requestUpdate();
    });
}

/** 强制重新获取模型列表 */
export function refetchModels(requestUpdate: () => void): void {
  _cachedModels = [];
  _fetchPromise = null;
  fetchModels(requestUpdate);
}

// ─── Provider Logos (内联 SVG) ──────────────────────────────

const providerLogos: Record<string, ReturnType<typeof html>> = {
  deepseek: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#4d6bfe" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        D
      </text>
    </svg>
  `,
  doubao: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#ff6154" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        豆
      </text>
    </svg>
  `,
  glm: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#3366ff" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        智
      </text>
    </svg>
  `,
  hunyuan: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#06b4fd" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        混
      </text>
    </svg>
  `,
  kimi: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#0066ff" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        K
      </text>
    </svg>
  `,
  longcat: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#8b5cf6" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        L
      </text>
    </svg>
  `,
  mimo: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#e74c3c" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        M
      </text>
    </svg>
  `,
  minimax: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#ff9500" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="12"
        font-weight="bold"
        font-family="sans-serif"
      >
        MM
      </text>
    </svg>
  `,
  qwen: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#ff6a00" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        千
      </text>
    </svg>
  `,
  openai: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#10a37f" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        G
      </text>
    </svg>
  `,
  anthropic: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#d4a27f" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        C
      </text>
    </svg>
  `,
  google: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#4285f4" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        G
      </text>
    </svg>
  `,
  other: html`
    <svg viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="15" fill="#666" />
      <text
        x="16"
        y="21"
        text-anchor="middle"
        fill="white"
        font-size="14"
        font-weight="bold"
        font-family="sans-serif"
      >
        ?
      </text>
    </svg>
  `,
};

const providerColors: Record<string, string> = {
  deepseek: "#4d6bfe",
  doubao: "#ff6154",
  glm: "#3366ff",
  hunyuan: "#06b4fd",
  kimi: "#0066ff",
  longcat: "#8b5cf6",
  mimo: "#e74c3c",
  minimax: "#ff9500",
  qwen: "#ff6a00",
  openai: "#10a37f",
  anthropic: "#d4a27f",
  google: "#4285f4",
  other: "#666",
};

// ─── OnestopProps ──────────────────────────────────────────

export type OnestopProps = {
  apiKey: string;
  selectedModel: string;
  showApiKey: boolean;
  activeCategory: string; // 现在用作 provider 筛选
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
      <path
        d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"
      ></path>
      <path
        d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"
      ></path>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
    </svg>
  `,
  key: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"
      ></path>
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
      <path
        d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
      ></path>
      <path d="M5 3v4"></path>
      <path d="M19 17v4"></path>
      <path d="M3 5h4"></path>
      <path d="M17 19h4"></path>
    </svg>
  `,
  refresh: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
      <path d="M8 16H3v5"></path>
    </svg>
  `,
};

// ─── 渲染函数 ───────────────────────────────────────────────

export function renderOnestop(props: OnestopProps) {
  // 触发模型获取
  fetchModels(props.requestUpdate);

  // 加载已有的 API Key 脱敏显示
  loadExistingApiKey(props.requestUpdate);

  // 保存最新的 requestUpdate 引用，避免闭包捕获过期引用
  _latestRequestUpdate = props.requestUpdate;

  // 监听自定义接入的主模型变更事件
  if (!_customPrimaryListenerAdded) {
    _customPrimaryListenerAdded = true;
    window.addEventListener("primary-model-changed", ((e: CustomEvent) => {
      _customPrimaryModel = e.detail?.modelId ?? null;
      _latestRequestUpdate?.();
    }) as EventListener);
  }

  const hasApiKey = Boolean(props.apiKey?.trim()) || Boolean(_existingMaskedKey);
  const selectedModelInfo = _cachedModels.find((m) => m.id === props.selectedModel);

  // 判断当前显示的模型信息
  // _customPrimaryModel 仅在用户通过自定义接入切换模型时设置，
  // 此时应优先显示（反映用户最近的选择）
  const showCustomModel = Boolean(_customPrimaryModel);
  const showOnestopModel = !showCustomModel && hasApiKey && selectedModelInfo;

  let onestopContent;
  if (_activeTab === "onestop") {
    onestopContent = renderOnestopContent(props);
  } else {
    // 自定义接入 tab 激活时不渲染一站式内容
    onestopContent = nothing;
  }

  return html`
    <div class="onestop">
      <!-- 全局状态栏：始终显示当前接入的模型 -->
      ${
        showOnestopModel
          ? html`
          <div class="onestop-status-bar">
            <div class="onestop-status-bar__info">
              <span class="onestop-status-bar__dot"></span>
              <span>当前模型:</span>
              <span class="onestop-status-bar__model">${selectedModelInfo.provider} / ${selectedModelInfo.name}</span>
              <span class="onestop-status-bar__id">(${selectedModelInfo.id})</span>
            </div>
            <div class="onestop-status-bar__actions">
              <button
                class="onestop-status-bar__test"
                ?disabled=${_testing}
                @click=${() => testOnestopConnection(props.requestUpdate)}
              >
                ${_testing ? "测试中…" : "测试连接"}
              </button>
            </div>
          </div>
          ${
            _testResult
              ? html`<div class="onestop-result ${_testResult.success ? "onestop-result--ok" : "onestop-result--err"}">${_testResult.message}</div>`
              : nothing
          }
        `
          : showCustomModel
            ? html`
          <div class="onestop-status-bar">
            <div class="onestop-status-bar__info">
              <span class="onestop-status-bar__dot"></span>
              <span>当前模型:</span>
              <span class="onestop-status-bar__model">${_customPrimaryModel}</span>
            </div>
            <div class="onestop-status-bar__actions">
              <button
                class="onestop-status-bar__test"
                ?disabled=${_testing}
                @click=${() => testOnestopConnection(props.requestUpdate)}
              >
                ${_testing ? "测试中…" : "测试连接"}
              </button>
            </div>
          </div>
          ${
            _testResult
              ? html`<div class="onestop-result ${_testResult.success ? "onestop-result--ok" : "onestop-result--err"}">${_testResult.message}</div>`
              : nothing
          }
        `
            : nothing
      }

      ${
        _saveResult
          ? html`<div class="onestop-result ${_saveResult.success ? "onestop-result--ok" : "onestop-result--err"}">${_saveResult.message}</div>`
          : nothing
      }



      <!-- Tab Navigation — 分段控制器 -->
      <div class="onestop-switcher">
        <button
          class="onestop-switcher__item ${_activeTab === "onestop" ? "active" : ""}"
          @click=${() => {
            _activeTab = "onestop";
            props.requestUpdate();
          }}
        >
          <div class="onestop-switcher__main">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="onestop-switcher__icon">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
            </svg>
            <span>一站式接入</span>
            <span class="onestop-switcher__badge">推荐</span>
          </div>
          <span class="onestop-switcher__desc">一个 API Key 接入所有模型</span>
        </button>
        <button
          class="onestop-switcher__item ${_activeTab === "custom" ? "active" : ""}"
          @click=${() => {
            _activeTab = "custom";
            props.requestUpdate();
          }}
        >
          <div class="onestop-switcher__main">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="onestop-switcher__icon">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>自定义接入</span>
          </div>
          <span class="onestop-switcher__desc">自行配置 OpenAI / Anthropic 兼容 API</span>
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
  const hasApiKey = Boolean(props.apiKey?.trim()) || Boolean(_existingMaskedKey);

  // Provider 筛选
  const allProviders = [...new Set(_cachedModels.map((m) => m.providerKey))];
  const activeFilter = props.activeCategory || "all";
  const filteredModels =
    activeFilter === "all"
      ? _cachedModels
      : _cachedModels.filter((m) => m.providerKey === activeFilter);

  // Provider 名称映射
  const providerNames: Record<string, string> = {};
  for (const m of _cachedModels) {
    providerNames[m.providerKey] = m.provider;
  }

  // 当前选中模型信息
  const selectedModelInfo = props.selectedModel
    ? _cachedModels.find((m) => m.id === props.selectedModel)
    : null;

  // 切换模型：更新 provider 配置（包括白名单和 primary）
  const handleSwitchModel = async (modelId: string) => {
    if (_testing) return;
    try {
      // saveOnestopConfig 已同时处理：provider 配置 + 白名单 + primary 设置
      // 单次写入避免 gateway 文件监视器触发多次重启
      await saveOnestopConfig(props.apiKey, modelId);
      // 立即更新 UI 显示
      props.onModelSelect(modelId);
      _customPrimaryModel = null;
      showSaveResult(
        true,
        `✓ 已切换为 ${formatModelName(modelId)}，请在聊天中发送 /new 开启新会话`,
        props.requestUpdate,
      );
    } catch (e) {
      showSaveResult(false, `切换失败: ${String(e)}`, props.requestUpdate);
    }
  };

  return html`
      <!-- Hero Banner -->
      <div class="onestop-hero">
        <div class="onestop-hero__glow"></div>
        <div class="onestop-hero__content">
          <div class="onestop-hero__icon">${icons.sparkles}</div>
          <div class="onestop-hero__text">
            <h2 class="onestop-hero__title">一站式接入全球AI大模型</h2>
            <p class="onestop-hero__subtitle">
              只需一个 API Key，即可接入 DeepSeek、通义千问、Kimi、GLM 等全球主流大语言模型
            </p>
          </div>
          <div class="onestop-hero__status">
            ${
              hasApiKey
                ? html`
                    <span class="onestop-badge onestop-badge--ok">
                      <span class="onestop-badge__dot"></span>
                      已接入
                    </span>
                  `
                : html`
                    <span class="onestop-badge onestop-badge--pending">
                      <span class="onestop-badge__dot"></span>
                      未配置
                    </span>
                  `
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
              placeholder=${_existingMaskedKey ? `已配置: ${_existingMaskedKey}` : "请输入您的 API Key"}
              .value=${props.apiKey}
              @input=${(e: Event) => props.onApiKeyChange((e.target as HTMLInputElement).value)}
            />
            <button
              class="onestop-apikey__toggle"
              @click=${props.onToggleShowApiKey}
              title=${props.showApiKey ? "隐藏" : "显示"}
            >
              ${props.showApiKey ? icons.eyeOff : icons.eye}
            </button>
            <button
              class="onestop-apikey__save"
              ?disabled=${!hasApiKey || props.saving}
              @click=${props.onSave}
            >
              ${props.saving ? "保存中…" : props.apiKey?.trim() ? "保存配置" : _existingMaskedKey ? "已配置" : "请先填写 API Key"}
            </button>
          </div>
          ${
            _existingMaskedKey && !props.apiKey?.trim()
              ? html`
                  <div class="onestop-apikey__hint">✓ API Key 已配置，输入新 Key 可更换</div>
                `
              : nothing
          }
        </div>
      </div>

      <!-- Step 2: Model Selection -->
      <div class="onestop-section">
        <div class="onestop-section__header">
          <div class="onestop-section__step">2</div>
          <div class="onestop-section__meta">
            <h3 class="onestop-section__title">选择AI模型</h3>
            <p class="onestop-section__desc">
              选择您想使用的默认模型，所有模型均通过统一 API 接入 ·
              <a href="${PRICING_URL}" target="_blank" rel="noopener noreferrer" class="onestop-link">
                查看模型详情与定价
                <span class="onestop-link__icon">${icons.externalLink}</span>
              </a>
            </p>
          </div>
          <button
            class="onestop-refresh-btn"
            @click=${() => refetchModels(props.requestUpdate)}
            title="刷新模型列表"
          >
            ${icons.refresh}
          </button>
        </div>

        ${
          _modelsLoading
            ? html`
                <div class="onestop-loading">
                  <div class="onestop-loading__spinner"></div>
                  <span>正在获取模型列表…</span>
                </div>
              `
            : _modelsError
              ? html`
            <div class="onestop-error">
              <span>获取模型列表失败: ${_modelsError}</span>
              <button class="onestop-error__retry" @click=${() => refetchModels(props.requestUpdate)}>重试</button>
            </div>
          `
              : html`
            <!-- Provider filter -->
            <div class="onestop-categories">
              <button
                class="onestop-categories__item ${activeFilter === "all" ? "active" : ""}"
                @click=${() => props.onCategoryChange("all")}
              >
                全部 (${_cachedModels.length})
              </button>
              ${allProviders.map(
                (pk) => html`
                  <button
                    class="onestop-categories__item ${activeFilter === pk ? "active" : ""}"
                    @click=${() => props.onCategoryChange(pk)}
                  >
                    ${providerNames[pk] ?? pk}
                    (${_cachedModels.filter((m) => m.providerKey === pk).length})
                  </button>
                `,
              )}
            </div>

            <!-- Model Grid (当前模型置顶) -->
            <div class="onestop-models">
              ${[...filteredModels]
                .sort((a, b) =>
                  !_customPrimaryModel && a.id === props.selectedModel
                    ? -1
                    : !_customPrimaryModel && b.id === props.selectedModel
                      ? 1
                      : 0,
                )
                .map((model) => {
                  const isCurrent = !_customPrimaryModel && props.selectedModel === model.id;
                  return html`
                  <div
                    class="onestop-model-card ${isCurrent ? "selected" : ""} ${_testing ? "locked" : ""}"
                  >
                    <div class="onestop-model-card__logo">
                      ${providerLogos[model.providerKey] ?? providerLogos.other}
                    </div>
                    <div class="onestop-model-card__body">
                      <div class="onestop-model-card__header">
                        <span
                          class="onestop-model-card__provider"
                          style="color: ${providerColors[model.providerKey] ?? "#888"}"
                        >
                          ${model.provider}
                        </span>
                        ${
                          isCurrent
                            ? html`<span class="onestop-model-card__check">${icons.check}</span>`
                            : nothing
                        }
                      </div>
                      <div class="onestop-model-card__name">${model.name}</div>
                      <div class="onestop-model-card__id">${model.id}</div>
                    </div>
                    <button
                      class="onestop-model-card__switch-btn"
                      ?disabled=${_testing || !hasApiKey || isCurrent}
                      @click=${() => handleSwitchModel(model.id)}
                      title="切换后请发送 /new 开启新会话"
                    >${isCurrent ? "✓ 当前" : "切换"}</button>
                  </div>
                `;
                })}
            </div>
          `
        }
      </div>
    </div>
  `;
}
