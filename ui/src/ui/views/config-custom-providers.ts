/**
 * 自定义配置接入 — 供应商管理组件
 *
 * 整合 openclaw-manager 的 AI 模型配置功能到一站式接入页面。
 * 通过 Tauri invoke 调用后端命令管理供应商、模型、API Key 等。
 */
import { html, nothing, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

// ─── Tauri invoke helper ────────────────────────────────────

function getTauri(): any {
  const w = window as any;
  return w.__TAURI__ ?? null;
}

async function invoke<T = any>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = getTauri();
  if (tauri?.core?.invoke) {
    return tauri.core.invoke(cmd, args);
  }
  throw new Error("Tauri invoke not available");
}

// ─── 类型定义 ────────────────────────────────────────────────

interface SuggestedModel {
  id: string;
  name: string;
  description: string | null;
  context_window: number | null;
  max_tokens: number | null;
  recommended: boolean;
}

interface OfficialProvider {
  id: string;
  name: string;
  icon: string;
  default_base_url: string | null;
  api_type: string;
  suggested_models: SuggestedModel[];
  requires_api_key: boolean;
  docs_url: string | null;
}

interface ConfiguredModel {
  full_id: string;
  id: string;
  name: string;
  api_type: string | null;
  context_window: number | null;
  max_tokens: number | null;
  is_primary: boolean;
}

interface ConfiguredProvider {
  name: string;
  base_url: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  models: ConfiguredModel[];
}

interface AIConfigOverview {
  primary_model: string | null;
  configured_providers: ConfiguredProvider[];
  available_models: string[];
}

interface AITestResult {
  success: boolean;
  provider: string;
  model: string;
  response: string | null;
  error: string | null;
  latency_ms: number | null;
}

// ─── SVG Icons ──────────────────────────────────────────────

const icons = {
  plus: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" x2="12" y1="5" y2="19"></line>
      <line x1="5" x2="19" y1="12" y2="12"></line>
    </svg>
  `,
  settings: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
      ></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `,
  trash: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `,
  edit: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
    </svg>
  `,
  check: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `,
  chevronDown: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m6 9 6 6 6-6"></path>
    </svg>
  `,
  chevronRight: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `,
  star: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
      ></polygon>
    </svg>
  `,
  zap: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
    </svg>
  `,
  loader: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="onestop-custom-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
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
  server: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2"></rect>
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2"></rect>
      <line x1="6" x2="6.01" y1="6" y2="6"></line>
      <line x1="6" x2="6.01" y1="18" y2="18"></line>
    </svg>
  `,
  cpu: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect width="16" height="16" x="4" y="4" rx="2"></rect>
      <rect width="6" height="6" x="9" y="9" rx="1"></rect>
      <path d="M15 2v2"></path>
      <path d="M15 20v2"></path>
      <path d="M2 15h2"></path>
      <path d="M2 9h2"></path>
      <path d="M20 15h2"></path>
      <path d="M20 9h2"></path>
      <path d="M9 2v2"></path>
      <path d="M9 20v2"></path>
    </svg>
  `,
  close: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" x2="6" y1="6" y2="18"></line>
      <line x1="6" x2="18" y1="6" y2="18"></line>
    </svg>
  `,
  arrowLeft: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m12 19-7-7 7-7"></path>
      <path d="M19 12H5"></path>
    </svg>
  `,
};

@customElement("openclaw-custom-providers")
export class CustomProvidersView extends LitElement {
  createRenderRoot() {
    return this; // Disable Shadow DOM to use global styles
  }

  @state() loading = false;
  @state() loadingStatus = "初始化中...";

  @state() error: string | null = null;
  @state() officialProviders: OfficialProvider[] = [];
  @state() aiConfig: AIConfigOverview | null = null;
  @state() testing = false;
  @state() testResult: AITestResult | null = null;

  // Form State
  @state() showAddForm = false;
  @state() addStep: "select" | "configure" = "select";
  @state() selectedOfficial: OfficialProvider | null = null;
  @state() formProviderName = "";
  @state() formBaseUrl = "";
  @state() formApiKey = "";
  @state() formApiType = "openai-completions";
  @state() formShowApiKey = false;
  @state() formSelectedModels: string[] = [];
  @state() formCustomModelId = "";
  @state() formSaving = false;
  @state() formError: string | null = null;

  @state() editingProvider: ConfiguredProvider | null = null;

  @state() deleteConfirmProvider: string | null = null;
  @state() deleting = false;

  @state() expandedProviders = new Set<string>();

  connectedCallback() {
    super.connectedCallback();
    if (!this.aiConfig && !this.loading) {
      this.loadData();
    }
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    this.loadingStatus = "初始化中...";
    // this.addLog("开始加载数据...");

    try {
      const officialPromise = invoke<OfficialProvider[]>("get_official_providers");
      const timeout1 = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("请求超时 (5000ms)")), 5000),
      );

      this.officialProviders = await Promise.race([officialPromise, timeout1]);

      const configPromise = invoke<AIConfigOverview>("get_ai_config");
      const timeout2 = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("请求超时 (5000ms)")), 5000),
      );
      this.aiConfig = await Promise.race([configPromise, timeout2]);

      // 过滤掉一站式接入的 provider，避免在自定义接入页面显示
      if (this.aiConfig?.configured_providers) {
        this.aiConfig.configured_providers = this.aiConfig.configured_providers.filter(
          (p) => p.name !== "onestop",
        );
      }

      // this.addLog("配置加载完成");
    } catch (e: any) {
      console.error("Load Data Error:", e);
      const errMsg = e?.message || String(e);
      this.error = errMsg;
      // this.addLog(`ERROR: ${errMsg}`);
    } finally {
      this.loading = false;
      // this.addLog("加载流程结束");
    }
  }

  /** Lightweight config refresh — only re-fetches AI config, no loading spinner. */
  async refreshConfig() {
    try {
      const config = await invoke<AIConfigOverview>("get_ai_config");
      if (config?.configured_providers) {
        config.configured_providers = config.configured_providers.filter(
          (p) => p.name !== "onestop",
        );
      }
      this.aiConfig = config;
    } catch (e) {
      console.error("refreshConfig error:", e);
    }
  }

  async handleSwitchModel(modelId: string) {
    try {
      await invoke<string>("switch_model", { modelId: modelId });
      await this.refreshConfig();
      // Notify parent components
      this.dispatchEvent(
        new CustomEvent("primary-model-changed", {
          detail: { modelId },
          bubbles: true,
          composed: true,
        }),
      );
      this.error = `✓ 已切换模型，请在聊天中发送 /new 开启新会话`;
      // 5 秒后自动清除成功提示
      setTimeout(() => {
        if (this.error?.startsWith("✓")) {
          this.error = null;
        }
      }, 5000);
    } catch (e) {
      this.error = "切换模型失败: " + String(e);
    }
  }

  async handleTestConnection() {
    this.testing = true;
    this.testResult = null;

    try {
      const result = await invoke<AITestResult>("test_ai_connection");
      this.testResult = result;
    } catch (e) {
      this.testResult = {
        success: false,
        provider: "unknown",
        model: "unknown",
        response: null,
        error: String(e),
        latency_ms: null,
      };
    } finally {
      this.testing = false;
      // 10 秒后自动隐藏测试结果
      setTimeout(() => {
        this.testResult = null;
      }, 10000);
    }
  }

  async handleDeleteProvider(providerName: string) {
    this.deleting = true;

    try {
      // 检查当前被删除的 provider 是否包含当前正在使用的全局主模型
      const primaryModel = this.aiConfig?.primary_model;
      const isDeletingPrimary =
        primaryModel &&
        (primaryModel === providerName || primaryModel.startsWith(`${providerName}/`));

      await invoke("delete_provider", { providerName: providerName });
      this.deleteConfirmProvider = null;
      await this.loadData();

      // 如果被删除的是当前正在使用的主模型，通知父组件清除状态栏高亮显示
      if (isDeletingPrimary) {
        this.dispatchEvent(
          new CustomEvent("primary-model-changed", {
            detail: { modelId: null },
            bubbles: true,
            composed: true,
          }),
        );
      }
    } catch (e) {
      this.error = "删除供应商失败: " + String(e);
    } finally {
      this.deleting = false;
    }
  }

  resetForm() {
    this.showAddForm = false;
    this.addStep = "select";
    this.selectedOfficial = null;
    this.formProviderName = "";
    this.formBaseUrl = "";
    this.formApiKey = "";
    this.formApiType = "openai-completions";
    this.formShowApiKey = false;
    this.formSelectedModels = [];
    this.formCustomModelId = "";
    this.formSaving = false;
    this.formError = null;
    this.editingProvider = null;
  }

  openAddForm() {
    this.resetForm();
    this.showAddForm = true;
    this.addStep = "select";
  }

  openEditForm(provider: ConfiguredProvider) {
    this.resetForm();
    this.showAddForm = true;
    this.addStep = "configure";
    this.editingProvider = provider;
    this.formProviderName = provider.name;
    this.formBaseUrl = provider.base_url;
    this.formSelectedModels = provider.models.map((m) => m.id);

    // 先尝试匹配官方 provider
    this.selectedOfficial =
      this.officialProviders.find((p) => provider.name.includes(p.id) || p.id === provider.name) ||
      null;

    // API 类型优先级：模型配置 > 官方 provider > 默认值
    this.formApiType =
      provider.models[0]?.api_type || this.selectedOfficial?.api_type || "openai-completions";
  }

  selectOfficialProvider(provider: OfficialProvider) {
    this.selectedOfficial = provider;
    this.formProviderName = provider.id;
    this.formBaseUrl = provider.default_base_url || "";
    this.formApiType = provider.api_type;
    const recommended = provider.suggested_models.filter((m) => m.recommended).map((m) => m.id);
    this.formSelectedModels =
      recommended.length > 0 ? recommended : [provider.suggested_models[0]?.id].filter(Boolean);
    this.formError = null;
    this.addStep = "configure";
  }

  selectCustomProvider() {
    this.selectedOfficial = null;
    this.formProviderName = "";
    this.formBaseUrl = "";
    this.formApiType = "openai-completions";
    this.formSelectedModels = [];
    this.formError = null;
    this.addStep = "configure";
  }

  toggleModel(modelId: string) {
    if (this.formSelectedModels.includes(modelId)) {
      this.formSelectedModels = this.formSelectedModels.filter((id) => id !== modelId);
    } else {
      this.formSelectedModels = [...this.formSelectedModels, modelId];
    }
    this.formError = null;
  }

  addCustomModel() {
    if (this.formCustomModelId && !this.formSelectedModels.includes(this.formCustomModelId)) {
      this.formSelectedModels = [...this.formSelectedModels, this.formCustomModelId];
      this.formCustomModelId = "";
      this.formError = null;
    }
  }

  async handleSaveProvider() {
    this.formError = null;

    if (!this.formProviderName || !this.formBaseUrl || this.formSelectedModels.length === 0) {
      this.formError = "请填写完整的供应商信息并至少选择一个模型";
      return;
    }

    this.formSaving = true;

    try {
      const models = this.formSelectedModels.map((modelId) => {
        const suggested = this.selectedOfficial?.suggested_models.find((m) => m.id === modelId);
        const existingModel = this.editingProvider?.models.find((m) => m.id === modelId);
        return {
          id: modelId,
          name: suggested?.name || existingModel?.name || modelId,
          api: this.formApiType,
          input: ["text", "image"],
          contextWindow: suggested?.context_window ?? existingModel?.context_window ?? 200000,
          maxTokens: suggested?.max_tokens ?? existingModel?.max_tokens ?? 8192,
          reasoning: false,
          cost: null,
        };
      });

      await invoke("save_provider", {
        providerName: this.formProviderName,
        baseUrl: this.formBaseUrl,
        apiKey: this.formApiKey || null,
        apiType: this.formApiType,
        models,
      });

      this.resetForm();
      await this.loadData();
    } catch (e) {
      this.formError = "保存失败: " + String(e);
      this.formSaving = false;
    }
  }

  renderProviderSelect() {
    return html`
      <div class="onestop-custom-provider-select">
        <div class="onestop-custom-grid">
          ${this.officialProviders.map(
            (provider) => html`
              <button
                class="onestop-custom-provider-option"
                @click=${() => this.selectOfficialProvider(provider)}
              >
                <span class="onestop-custom-provider-option__icon">${provider.icon}</span>
                <div class="onestop-custom-provider-option__info">
                  <span class="onestop-custom-provider-option__name">${provider.name}</span>
                  <span class="onestop-custom-provider-option__count">${provider.suggested_models.length} 个模型</span>
                </div>
                <span class="onestop-custom-provider-option__arrow">${icons.chevronRight}</span>
              </button>
            `,
          )}
        </div>
        <button
          class="onestop-custom-provider-custom"
          @click=${() => this.selectCustomProvider()}
        >
          <span class="onestop-custom-provider-custom__icon">${icons.settings}</span>
          <span>自定义供应商 (兼容 OpenAI/Anthropic API)</span>
        </button>
      </div>
    `;
  }

  renderConfigureForm() {
    const isEditing = !!this.editingProvider;

    return html`
      <div class="onestop-custom-form">
        <!-- 供应商名称 -->
        <div class="onestop-custom-field">
          <label class="onestop-custom-label">
            供应商名称
            <span class="onestop-custom-label__hint">用于配置标识</span>
          </label>
          <input
            type="text"
            class="onestop-custom-input"
            placeholder="如: anthropic-custom, my-openai"
            .value=${this.formProviderName}
            ?disabled=${isEditing}
            @input=${(e: Event) => {
              this.formProviderName = (e.target as HTMLInputElement).value;
              this.formError = null;
            }}
          />
        </div>

        <!-- API 地址 -->
        <div class="onestop-custom-field">
          <label class="onestop-custom-label">API 地址</label>
          <input
            type="text"
            class="onestop-custom-input"
            placeholder="https://api.example.com/v1"
            .value=${this.formBaseUrl}
            @input=${(e: Event) => {
              this.formBaseUrl = (e.target as HTMLInputElement).value;
              this.formError = null;
            }}
          />
        </div>

        <!-- API Key -->
        <div class="onestop-custom-field">
          <label class="onestop-custom-label">
            API Key
            ${
              !this.selectedOfficial?.requires_api_key
                ? html`
                    <span class="onestop-custom-label__hint">(可选)</span>
                  `
                : nothing
            }
          </label>
          ${
            isEditing && this.editingProvider?.has_api_key
              ? html`<div class="onestop-custom-apikey-current">
                <span class="onestop-custom-label__hint">当前:</span>
                <code class="onestop-custom-code">${this.editingProvider.api_key_masked}</code>
              </div>`
              : nothing
          }
          <div class="onestop-apikey__field">
            <input
              type=${this.formShowApiKey ? "text" : "password"}
              class="onestop-apikey__input"
              placeholder=${
                isEditing && this.editingProvider?.has_api_key
                  ? "留空保持原有 Key，或输入新的 Key"
                  : "sk-..."
              }
              .value=${this.formApiKey}
              @input=${(e: Event) => {
                this.formApiKey = (e.target as HTMLInputElement).value;
              }}
            />
            <button
              class="onestop-apikey__toggle"
              @click=${() => (this.formShowApiKey = !this.formShowApiKey)}
              title=${this.formShowApiKey ? "隐藏" : "显示"}
            >
              ${this.formShowApiKey ? icons.eyeOff : icons.eye}
            </button>
          </div>
        </div>

        <!-- API 类型 -->
        <div class="onestop-custom-field">
          <label class="onestop-custom-label">API 类型</label>
          <select
            class="onestop-custom-select"
            .value=${this.formApiType}
            @change=${(e: Event) => {
              this.formApiType = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="openai-completions">OpenAI 兼容 (openai-completions)</option>
            <option value="anthropic-messages">Anthropic 兼容 (anthropic-messages)</option>
          </select>
        </div>

        <!-- 模型选择 -->
        <div class="onestop-custom-field">
          <label class="onestop-custom-label">
            选择模型
            <span class="onestop-custom-label__hint">(已选 ${this.formSelectedModels.length} 个)</span>
          </label>

          ${
            this.selectedOfficial
              ? html`
                <div class="onestop-custom-model-list">
                  ${this.selectedOfficial.suggested_models.map(
                    (model) => html`
                      <button
                        class="onestop-custom-model-item ${this.formSelectedModels.includes(model.id) ? "selected" : ""}"
                        @click=${() => this.toggleModel(model.id)}
                      >
                        <div class="onestop-custom-model-item__info">
                          <span class="onestop-custom-model-item__name">
                            ${model.name}
                            ${
                              model.recommended
                                ? html`
                                    <span class="onestop-custom-model-item__badge">推荐</span>
                                  `
                                : nothing
                            }
                          </span>
                          ${
                            model.description
                              ? html`<span class="onestop-custom-model-item__desc">${model.description}</span>`
                              : nothing
                          }
                        </div>
                        ${
                          this.formSelectedModels.includes(model.id)
                            ? html`<span class="onestop-custom-model-item__check">${icons.check}</span>`
                            : nothing
                        }
                      </button>
                    `,
                  )}
                </div>
              `
              : nothing
          }

          <!-- 自定义模型输入 -->
          <div class="onestop-custom-model-add">
            <input
              type="text"
              class="onestop-custom-input"
              placeholder="输入自定义模型 ID"
              .value=${this.formCustomModelId}
              @input=${(e: Event) => {
                this.formCustomModelId = (e.target as HTMLInputElement).value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  this.addCustomModel();
                }
              }}
            />
            <button
              class="onestop-custom-btn-icon"
              ?disabled=${!this.formCustomModelId}
              @click=${() => this.addCustomModel()}
            >
              ${icons.plus}
            </button>
          </div>

          <!-- 已添加的自定义模型标签 -->
          ${
            this.formSelectedModels.filter(
              (id) => !this.selectedOfficial?.suggested_models.find((m) => m.id === id),
            ).length > 0
              ? html`
                <div class="onestop-custom-model-tags">
                  ${this.formSelectedModels
                    .filter(
                      (id) => !this.selectedOfficial?.suggested_models.find((m) => m.id === id),
                    )
                    .map(
                      (modelId) => html`
                        <span class="onestop-custom-model-tag">
                          ${modelId}
                          <button class="onestop-custom-model-tag__remove" @click=${() => this.toggleModel(modelId)}>✕</button>
                        </span>
                      `,
                    )}
                </div>
              `
              : nothing
          }
        </div>

        <!-- 文档链接 -->
        ${
          this.selectedOfficial?.docs_url
            ? html`
              <a
                href=${this.selectedOfficial.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                class="onestop-link"
              >
                <span class="onestop-link__icon">${icons.externalLink}</span>
                查看官方文档
              </a>
            `
            : nothing
        }

        <!-- 错误提示 -->
        ${
          this.formError ? html`<div class="onestop-custom-error">${this.formError}</div>` : nothing
        }

        <!-- 操作按钮 -->
        <div class="onestop-custom-form-actions">
          ${
            !isEditing
              ? html`<button class="onestop-custom-btn-secondary" @click=${() => {
                  this.addStep = "select";
                }}>${icons.arrowLeft} 返回</button>`
              : nothing
          }
          <div class="onestop-custom-form-actions__right">
            <button class="onestop-custom-btn-secondary" @click=${() => this.resetForm()}>取消</button>
            <button
              class="onestop-custom-btn-primary"
              ?disabled=${this.formSaving || !this.formProviderName || !this.formBaseUrl || this.formSelectedModels.length === 0}
              @click=${() => this.handleSaveProvider()}
            >
              ${this.formSaving ? icons.loader : icons.check}
              ${isEditing ? "更新" : "保存"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderProviderCard(provider: ConfiguredProvider) {
    const expanded = this.expandedProviders.has(provider.name);
    const officialInfo = this.officialProviders.find(
      (p) => provider.name.includes(p.id) || p.id === provider.name,
    );
    const isDeleting = this.deleteConfirmProvider === provider.name;

    return html`
      <div class="onestop-custom-card ${expanded ? "expanded" : ""}">
        <!-- 卡片头部 -->
        <div
          class="onestop-custom-card__header"
          @click=${() => {
            if (expanded) {
              this.expandedProviders.delete(provider.name);
            } else {
              this.expandedProviders.add(provider.name);
            }
            this.requestUpdate();
          }}
        >
          <span class="onestop-custom-card__icon">${officialInfo?.icon || "🔌"}</span>
          <div class="onestop-custom-card__info">
            <div class="onestop-custom-card__name-row">
              <span class="onestop-custom-card__name">${provider.name}</span>
              ${
                provider.has_api_key
                  ? html`
                      <span class="onestop-custom-tag onestop-custom-tag--ok">已配置</span>
                    `
                  : nothing
              }
            </div>
            <span class="onestop-custom-card__url">${provider.base_url}</span>
          </div>
          <div class="onestop-custom-card__right">
            <span class="onestop-custom-card__count">${provider.models.length} 模型</span>
            <span class="onestop-custom-card__chevron ${expanded ? "expanded" : ""}">${icons.chevronDown}</span>
          </div>
        </div>

        <!-- 展开内容 -->
        ${
          expanded
            ? html`
              <div class="onestop-custom-card__body">
                ${
                  provider.api_key_masked
                    ? html`
                      <div class="onestop-custom-card__detail">
                        <span class="onestop-custom-label__hint">API Key:</span>
                        <code class="onestop-custom-code">${provider.api_key_masked}</code>
                      </div>
                    `
                    : nothing
                }

                <!-- 模型列表 (当前模型置顶) -->
              <div class="onestop-custom-card__models">
                ${[...provider.models]
                  .toSorted((a, b) => (a.is_primary === b.is_primary ? 0 : a.is_primary ? -1 : 1))
                  .map(
                    (model) => html`
                      <div class="onestop-custom-model-row ${model.is_primary ? "primary" : ""}">
                        <div class="onestop-custom-model-row__left">
                          <span class="onestop-custom-model-row__icon">${icons.cpu}</span>
                          <div>
                            <span class="onestop-custom-model-row__name">
                              ${model.name}
                              ${
                                model.is_primary
                                  ? html`<span class="onestop-custom-model-row__star">${icons.star} 主模型</span>`
                                  : nothing
                              }
                            </span>
                            <span class="onestop-custom-model-row__id">${model.full_id}</span>
                          </div>
                        </div>
                      <div class="onestop-custom-model-row__actions">
                        <button
                          class="onestop-custom-btn-text onestop-custom-btn-text--switch"
                          title="切换后请发送 /new 开启新会话"
                          ?disabled=${model.is_primary}
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.handleSwitchModel(model.full_id);
                          }}
                        >${model.is_primary ? "✓ 当前" : "切换"}</button>
                      </div>
                      </div>
                    `,
                  )}
                </div>

                <!-- 删除确认 -->
                ${
                  isDeleting
                    ? html`
                      <div class="onestop-custom-delete-confirm">
                        <p>⚠️ 确定要删除供应商 "${provider.name}" 吗？这将同时删除其下所有模型配置。</p>
                        <div class="onestop-custom-delete-confirm__actions">
                          <button
                            class="onestop-custom-btn-danger"
                            ?disabled=${this.deleting}
                            @click=${() => this.handleDeleteProvider(provider.name)}
                          >
                            ${this.deleting ? icons.loader : icons.trash}
                            确认删除
                          </button>
                          <button
                            class="onestop-custom-btn-secondary"
                            @click=${() => (this.deleteConfirmProvider = null)}
                          >取消</button>
                        </div>
                      </div>
                    `
                    : html`
                      <div class="onestop-custom-card__actions">
                        <button
                          class="onestop-custom-btn-text"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.openEditForm(provider);
                          }}
                        >${icons.edit} 编辑供应商</button>
                        <button
                          class="onestop-custom-btn-text onestop-custom-btn-text--danger"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            this.deleteConfirmProvider = provider.name;
                          }}
                        >${icons.trash} 删除供应商</button>
                      </div>
                    `
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="onestop-section" style="position:relative;">
          <!-- Debug Overlay -->


          <div class="onestop-section__header">
            <div class="onestop-section__meta">
              <h3 class="onestop-section__title">自定义接入</h3>
              <p class="onestop-section__desc">${this.loadingStatus}</p>
            </div>
            <button class="onestop-custom-btn-secondary" @click=${() => {
              this.loading = false;
              this.aiConfig = null;
              this.error = null;

              this.loadData();
            }}>强制刷新</button>
          </div>
          <div class="onestop-custom-loading">
            <span class="onestop-loading__spinner">${icons.loader}</span>
            <span class="onestop-loading__text" style="color: red; font-weight: bold;">${this.loadingStatus}</span>
          </div>
        </div>
      `;
    }

    if (this.error && !this.aiConfig) {
      return html`
        <div class="onestop-section">
          <div class="onestop-section__header">
            <div class="onestop-section__meta">
              <h3 class="onestop-section__title">自定义接入</h3>
              <p class="onestop-section__desc">加载失败</p>
            </div>
          </div>
          <div class="onestop-custom-error">
            ${this.error}
            <button class="onestop-custom-btn-text" @click=${() => this.loadData()}>重试</button>
          </div>
        </div>
      `;
    }

    return html`
      <div class="onestop-section">
        <div class="onestop-section__header">
          <div class="onestop-section__meta">
            <h3 class="onestop-section__title">自定义接入</h3>
            <p class="onestop-section__desc">
              管理自定义 AI 供应商和模型，支持任何 OpenAI / Anthropic 兼容 API
            </p>
          </div>
        </div>

        <div class="onestop-section__body">

          <!-- 概览 -->
          <div class="onestop-custom-overview">
            <div class="onestop-custom-overview__info">
              <div class="onestop-custom-overview__primary">
                <span class="onestop-custom-overview__icon">${icons.star}</span>
                <div>
                  <span class="onestop-custom-label__hint">当前主模型</span>
                  <span class="onestop-custom-overview__model">
                    ${this.aiConfig?.primary_model || "未设置"}
                  </span>
                </div>
              </div>
              <div class="onestop-custom-overview__stats">
                <span>${this.aiConfig?.configured_providers.length || 0} 个供应商</span>
                <span>·</span>
                <span>${this.aiConfig?.available_models.length || 0} 个可用模型</span>
              </div>
            </div>
            <div class="onestop-custom-overview__actions">
              <button
                class="onestop-custom-btn-secondary"
                ?disabled=${this.testing || !this.aiConfig?.primary_model}
                @click=${() => this.handleTestConnection()}
              >
                ${this.testing ? icons.loader : icons.zap}
                测试连接
              </button>
              <button class="onestop-custom-btn-primary" @click=${() => this.openAddForm()}>
                ${icons.plus} 添加供应商
              </button>
            </div>
          </div>

          <!-- 测试结果 -->
          ${
            this.testResult
              ? html`
                <div class="onestop-custom-test-result ${this.testResult.success ? "success" : "error"}">
                  <div class="onestop-custom-test-result__compact-info">
                    <span class="onestop-custom-test-result__status">
                      ${this.testResult.success ? icons.check : icons.close}
                      ${this.testResult.success ? "测试连接成功" : "测试连接失败"}
                    </span>
                    ${
                      this.testResult.latency_ms
                        ? html`<span class="onestop-custom-label__hint" style="font-family: var(--mono); margin-left: -4px;">${this.testResult.latency_ms}ms</span>`
                        : nothing
                    }
                    ${
                      this.testResult.error || this.testResult.response
                        ? html`<span class="onestop-custom-test-result__compact-msg" title=${this.testResult.error || this.testResult.response}>${this.testResult.error || this.testResult.response}</span>`
                        : nothing
                    }
                  </div>
                  <button class="onestop-custom-btn-text" @click=${() => {
                    this.testResult = null;
                  }} style="flex-shrink: 0;">关闭</button>
                </div>
              `
              : nothing
          }

          <!-- 添加/编辑供应商表单 -->
          ${
            this.showAddForm
              ? html`
                <div class="onestop-custom-add-section">
                  <div class="onestop-custom-add-section__header">
                    <span class="onestop-custom-add-section__title">
                      ${
                        this.editingProvider
                          ? `编辑供应商: ${this.editingProvider.name}`
                          : this.addStep === "select"
                            ? "添加 AI 供应商"
                            : `配置 ${this.selectedOfficial?.name || "自定义供应商"}`
                      }
                    </span>
                    <button class="onestop-custom-btn-icon" @click=${() => {
                      this.resetForm();
                    }}>${icons.close}</button>
                  </div>
                  ${this.addStep === "select" ? this.renderProviderSelect() : this.renderConfigureForm()}
                </div>
              `
              : nothing
          }

          <!-- 已配置的供应商列表 -->
          ${
            this.aiConfig && this.aiConfig.configured_providers.length > 0
              ? html`
                <div class="onestop-custom-providers-list">
                  <h4 class="onestop-custom-providers-list__title">
                    ${icons.server} 已配置的供应商
                  </h4>
                  ${this.aiConfig.configured_providers.map((provider) => this.renderProviderCard(provider))}
                </div>
              `
              : !this.showAddForm
                ? html`
                  <div class="onestop-custom-empty">
                    <span class="onestop-custom-empty__icon">${icons.plus}</span>
                    <p>还没有配置任何自定义 AI 供应商</p>
                    <button class="onestop-custom-btn-primary" @click=${() => this.openAddForm()}>
                      添加第一个供应商
                    </button>
                  </div>
                `
                : nothing
          }

          <!-- 错误提示 -->
          ${
            this.error && this.aiConfig
              ? html`<div class="onestop-custom-error">${this.error}</div>`
              : nothing
          }
        </div>
      </div>
    `;
  }
}

export type CustomProvidersProps = {
  requestUpdate: () => void;
};

export function renderCustomProviders(_props: CustomProvidersProps) {
  return html`
    <openclaw-custom-providers></openclaw-custom-providers>
  `;
}
