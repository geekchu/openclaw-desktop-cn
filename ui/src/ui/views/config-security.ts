import { html, nothing } from "lit";

export type SecuritySectionProps = {
  formValue: Record<string, unknown> | null;
  disabled: boolean;
  onPatch: (path: Array<string | number>, value: unknown) => void;
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

export function renderSecuritySection(props: SecuritySectionProps) {
  const { formValue, disabled, onPatch } = props;

  const host = (deepGet(formValue, ["tools", "exec", "host"]) as string | undefined) ?? "gateway";
  const security =
    (deepGet(formValue, ["tools", "exec", "security"]) as string | undefined) ?? "allowlist";
  const ask = (deepGet(formValue, ["tools", "exec", "ask"]) as string | undefined) ?? "on-miss";

  const hostOptions = [
    { value: "sandbox", label: "sandbox", desc: "Docker 沙箱环境执行" },
    { value: "gateway", label: "gateway", desc: "网关主机直接执行" },
    { value: "node", label: "node", desc: "Node.js 进程内执行" },
  ];

  const securityOptions = [
    { value: "deny", label: "deny", desc: "拒绝所有命令执行" },
    { value: "allowlist", label: "allowlist", desc: "仅允许白名单中的命令" },
    { value: "full", label: "full", desc: "允许执行任意命令" },
  ];

  const askOptions = [
    { value: "off", label: "off", desc: "不需要审批" },
    { value: "on-miss", label: "on-miss", desc: "不在白名单中时请求审批" },
    { value: "always", label: "always", desc: "每次执行都请求审批" },
  ];

  const isSandbox = host === "sandbox";

  return html`
    <div class="config-form config-form--modern">
      <!-- 执行主机 -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">执行主机</h3>
            <p class="config-section-card__desc">
              选择命令在哪里运行。sandbox 模式在 Docker 沙箱中执行，gateway 在网关主机上直接执行。
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="cfg-field">
            <label class="cfg-field__label">tools.exec.host</label>
            <div class="cfg-segmented">
              ${hostOptions.map(
                (opt) => html`
                  <button
                    type="button"
                    class="cfg-segmented__btn ${host === opt.value ? "active" : ""}"
                    ?disabled=${disabled}
                    @click=${() => onPatch(["tools", "exec", "host"], opt.value)}
                  >
                    ${opt.label}
                  </button>
                `,
              )}
            </div>
            <div class="cfg-field__help">
              ${hostOptions.find((o) => o.value === host)?.desc ?? ""}
            </div>
          </div>
          ${
            isSandbox
              ? html`
                  <div
                    class="callout"
                    style="
                      margin-top: 14px;
                      background: var(--warning-subtle, rgba(234, 179, 8, 0.1));
                      border: 1px solid rgba(234, 179, 8, 0.3);
                      border-radius: var(--radius-md);
                      padding: 12px 16px;
                      font-size: 13px;
                      color: var(--text);
                    "
                  >
                    <strong>注意：</strong> sandbox 模式下，命令在隔离容器中执行，安全模式和命令审批设置
                    <strong>不生效</strong>。如需启用审批，请切换到 gateway 或 node。
                  </div>
                `
              : nothing
          }
        </div>
      </section>

      <!-- 安全模式 -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">安全模式</h3>
            <p class="config-section-card__desc">
              控制哪些命令可以被执行。deny 拒绝所有，allowlist 仅允许白名单，full 允许全部。
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="cfg-field">
            <label class="cfg-field__label">tools.exec.security</label>
            <div class="cfg-segmented">
              ${securityOptions.map(
                (opt) => html`
                  <button
                    type="button"
                    class="cfg-segmented__btn ${security === opt.value ? "active" : ""}"
                    ?disabled=${disabled || isSandbox}
                    @click=${() => onPatch(["tools", "exec", "security"], opt.value)}
                  >
                    ${opt.label}
                  </button>
                `,
              )}
            </div>
            <div class="cfg-field__help">
              ${securityOptions.find((o) => o.value === security)?.desc ?? ""}
              ${isSandbox ? " (sandbox 模式下此设置不生效)" : ""}
            </div>
          </div>
        </div>
      </section>

      <!-- 命令审批 -->
      <section class="config-section-card">
        <div class="config-section-card__header">
          <span class="config-section-card__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
          </span>
          <div class="config-section-card__titles">
            <h3 class="config-section-card__title">命令审批</h3>
            <p class="config-section-card__desc">
              是否在执行命令前请求用户确认。always 每次都需确认，on-miss
              仅在命令不在白名单中时确认。
            </p>
          </div>
        </div>
        <div class="config-section-card__content">
          <div class="cfg-field">
            <label class="cfg-field__label">tools.exec.ask</label>
            <div class="cfg-segmented">
              ${askOptions.map(
                (opt) => html`
                  <button
                    type="button"
                    class="cfg-segmented__btn ${ask === opt.value ? "active" : ""}"
                    ?disabled=${disabled || isSandbox}
                    @click=${() => onPatch(["tools", "exec", "ask"], opt.value)}
                  >
                    ${opt.label}
                  </button>
                `,
              )}
            </div>
            <div class="cfg-field__help">
              ${askOptions.find((o) => o.value === ask)?.desc ?? ""}
              ${isSandbox ? " (sandbox 模式下此设置不生效)" : ""}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}
