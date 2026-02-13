import { html, nothing } from "lit";

export type SecuritySectionProps = {
  formValue: Record<string, unknown> | null;
  disabled: boolean;
  dockerChecking: boolean;
  onPatch: (path: Array<string | number>, value: unknown) => void;
  onAddDirectory: (hostPath: string, containerPath: string, mode: "ro" | "rw") => void;
  onRemoveDirectory: (index: number) => void;
};

// Read a deeply nested value from a Record tree
function deepGet(obj: Record<string, unknown> | null, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

type BindMount = {
  host: string;
  container: string;
  mode: string;
};

/** Parse "host:container:mode" bind mount strings */
function parseBinds(binds: unknown): BindMount[] {
  if (!Array.isArray(binds)) return [];
  return binds
    .filter((b): b is string => typeof b === "string")
    .map((b) => {
      // Handle Windows paths like C:\path:container:mode - split from the right
      const lastColon = b.lastIndexOf(":");
      if (lastColon < 0) return { host: b, container: b, mode: "rw" };
      const modeCandidate = b.slice(lastColon + 1);
      if (modeCandidate === "ro" || modeCandidate === "rw") {
        const rest = b.slice(0, lastColon);
        const secondLastColon = rest.lastIndexOf(":");
        if (secondLastColon < 0) return { host: rest, container: rest, mode: modeCandidate };
        return {
          host: rest.slice(0, secondLastColon),
          container: rest.slice(secondLastColon + 1),
          mode: modeCandidate,
        };
      }
      // No mode suffix, treat as host:container with default rw
      const colonIdx = b.lastIndexOf(":");
      return { host: b.slice(0, colonIdx), container: b.slice(colonIdx + 1), mode: "rw" };
    });
}

export function renderSecuritySection(props: SecuritySectionProps) {
  const { formValue, disabled, onPatch } = props;

  const security =
    (deepGet(formValue, ["tools", "exec", "security"]) as string | undefined) ?? "allowlist";
  const ask = (deepGet(formValue, ["tools", "exec", "ask"]) as string | undefined) ?? "on-miss";

  // Determine if directory access restriction is active
  const sandboxMode =
    (deepGet(formValue, ["agents", "defaults", "sandbox", "mode"]) as string | undefined) ?? "off";
  const host = (deepGet(formValue, ["tools", "exec", "host"]) as string | undefined) ?? "gateway";
  const directoryAccessEnabled = sandboxMode !== "off" && host === "sandbox";

  // Get current bind mounts
  const bindsRaw = deepGet(formValue, ["agents", "defaults", "sandbox", "docker", "binds"]);
  const binds = parseBinds(bindsRaw);

  const securityOptions = [
    { value: "deny", label: "拒绝全部", desc: "拒绝所有命令执行" },
    { value: "allowlist", label: "白名单", desc: "仅允许白名单中的命令" },
    { value: "full", label: "完全放开", desc: "允许执行任意命令" },
  ];

  const askOptions = [
    { value: "off", label: "关闭", desc: "不需要审批" },
    { value: "on-miss", label: "缺失时", desc: "不在白名单中时请求审批" },
    { value: "always", label: "总是", desc: "每次执行都请求审批" },
  ];

  return html`
    <div class="config-form config-form--modern">
      <!-- 安全模式概览 -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">安全控制模式</h3>
            <p class="config-section-card__desc">
              ${
                directoryAccessEnabled
                  ? "当前使用 Docker 沙盒隔离模式，命令在容器中执行，仅可访问指定目录。"
                  : "当前使用内置安全控制模式，通过命令白名单和审批机制保护系统安全。"
              }
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="security-mode-indicator">
            <div class="security-mode-indicator__badge ${directoryAccessEnabled ? "sandbox" : "builtin"}">
              ${
                directoryAccessEnabled
                  ? html`
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        style="width: 18px; height: 18px"
                      >
                        <path
                          d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                        ></path>
                      </svg>
                      Docker 沙盒隔离
                    `
                  : html`
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        style="width: 18px; height: 18px"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                      内置安全控制
                    `
              }
            </div>
          </div>
        </div>
      </section>

      <!-- 内置安全控制 (仅在非沙盒模式下可编辑) -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <polyline points="9 12 11 14 15 10"></polyline>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">命令执行控制</h3>
            <p class="config-section-card__desc">
              控制哪些命令可以被执行，以及是否需要人工审批。
              ${directoryAccessEnabled ? " (沙盒模式下此设置不生效)" : ""}
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="cfg-fields">
            <!-- 安全模式 -->
            <div class="cfg-field">
              <label class="cfg-field__label">命令执行策略</label>
              <div class="cfg-segmented">
                ${securityOptions.map(
                  (opt) => html`
                    <button
                      type="button"
                      class="cfg-segmented__btn ${security === opt.value ? "active" : ""}"
                      ?disabled=${disabled || directoryAccessEnabled}
                      @click=${() => onPatch(["tools", "exec", "security"], opt.value)}
                    >
                      ${opt.label}
                    </button>
                  `,
                )}
              </div>
              <div class="cfg-field__help">
                ${securityOptions.find((o) => o.value === security)?.desc ?? ""}
              </div>
            </div>

            <!-- 命令审批 -->
            <div class="cfg-field">
              <label class="cfg-field__label">命令审批</label>
              <div class="cfg-segmented">
                ${askOptions.map(
                  (opt) => html`
                    <button
                      type="button"
                      class="cfg-segmented__btn ${ask === opt.value ? "active" : ""}"
                      ?disabled=${disabled || directoryAccessEnabled}
                      @click=${() => onPatch(["tools", "exec", "ask"], opt.value)}
                    >
                      ${opt.label}
                    </button>
                  `,
                )}
              </div>
              <div class="cfg-field__help">
                ${askOptions.find((o) => o.value === ask)?.desc ?? ""}
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 目录访问限制 -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">目录访问限制</h3>
            <p class="config-section-card__desc">
              添加限制目录后，所有命令将在 Docker 容器中执行，仅能访问您指定的目录。移除所有目录则恢复正常模式。
              ${
                props.dockerChecking
                  ? html`
                      <span class="security-checking-badge">正在检测 Docker...</span>
                    `
                  : nothing
              }
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="security-dirs">
            ${
              directoryAccessEnabled
                ? html`
                  <div class="security-dirs__header">
                    <span class="security-dirs__title">允许访问的目录</span>
                    <span class="security-dirs__count">${binds.length} 个</span>
                  </div>
                `
                : nothing
            }

            ${
              binds.length > 0
                ? html`
                  <div class="security-dirs__list">
                    ${binds.map(
                      (bind, i) => html`
                        <div class="security-dirs__item">
                          <div class="security-dirs__item-info">
                            <div class="security-dirs__item-path">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:16px;height:16px;flex-shrink:0;opacity:0.6;">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                              </svg>
                              <span class="mono">${bind.host}</span>
                            </div>
                            <div class="security-dirs__item-meta">
                              <span>挂载到: <code>${bind.container}</code></span>
                              <span class="security-dirs__item-mode ${bind.mode === "ro" ? "ro" : "rw"}">
                                ${bind.mode === "ro" ? "只读" : "读写"}
                              </span>
                            </div>
                          </div>
                          <button
                            class="security-dirs__item-remove"
                            ?disabled=${disabled}
                            title="移除此目录"
                            @click=${() => props.onRemoveDirectory(i)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `
                : nothing
            }

            <!-- 添加目录表单 (始终显示) -->
            <div class="security-dirs__add">
              <div class="security-dirs__add-row">
                <input
                  type="text"
                  class="cfg-input cfg-input--sm"
                  placeholder="主机路径，如 /home/user/projects"
                  id="security-dir-host"
                />
                <input
                  type="text"
                  class="cfg-input cfg-input--sm"
                  placeholder="容器路径，如 /workspace"
                  id="security-dir-container"
                />
                <select class="cfg-select" id="security-dir-mode" style="min-width: 80px;">
                  <option value="rw">读写</option>
                  <option value="ro">只读</option>
                </select>
                <button
                  class="btn btn--sm primary"
                  ?disabled=${disabled || props.dockerChecking}
                  @click=${() => {
                    const hostInput = document.getElementById(
                      "security-dir-host",
                    ) as HTMLInputElement;
                    const containerInput = document.getElementById(
                      "security-dir-container",
                    ) as HTMLInputElement;
                    const modeSelect = document.getElementById(
                      "security-dir-mode",
                    ) as HTMLSelectElement;
                    const hostPath = hostInput?.value?.trim();
                    const containerPath = containerInput?.value?.trim();
                    const mode = (modeSelect?.value ?? "rw") as "ro" | "rw";
                    if (hostPath && containerPath) {
                      props.onAddDirectory(hostPath, containerPath, mode);
                      if (hostInput) hostInput.value = "";
                      if (containerInput) containerInput.value = "";
                    }
                  }}
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}
