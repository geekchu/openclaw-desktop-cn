import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state";

export function renderGatewayUrlConfirmation(state: AppViewState) {
  const { pendingGatewayUrl } = state;
  if (!pendingGatewayUrl) return nothing;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">更改网关地址</div>
            <div class="exec-approval-sub">这将重新连接到不同的网关服务器</div>
          </div>
        </div>
        <div class="exec-approval-command mono">${pendingGatewayUrl}</div>
        <div class="callout danger" style="margin-top: 12px;">
          仅在您信任此地址时才确认。恶意地址可能会危害您的系统。
        </div>
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            @click=${() => state.handleGatewayUrlConfirm()}
          >
            确认
          </button>
          <button
            class="btn"
            @click=${() => state.handleGatewayUrlCancel()}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  `;
}
