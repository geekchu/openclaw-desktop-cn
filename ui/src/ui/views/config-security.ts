import { html } from "lit";

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

  const security =
    (deepGet(formValue, ["tools", "exec", "security"]) as string | undefined) ?? "allowlist";
  const ask = (deepGet(formValue, ["tools", "exec", "ask"]) as string | undefined) ?? "on-miss";

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
      <!-- 命令执行控制 -->
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
                      ?disabled=${disabled}
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
                      ?disabled=${disabled}
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
    </div>
  `;
}
