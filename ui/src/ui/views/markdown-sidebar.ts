import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { until } from "lit/directives/until.js";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtmlAsync } from "../markdown.ts";

export type MarkdownSidebarProps = {
  content: string | null;
  error: string | null;
  onClose: () => void;
  onViewRawText: () => void;
};

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div class="sidebar-title">工具输出</div>
        <button @click=${props.onClose} class="btn" title="关闭侧边栏">
          ${icons.x}
        </button>
      </div>
      <div class="sidebar-content">
        ${
          props.error
            ? html`
              <div class="callout danger">${props.error}</div>
              <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
                查看原始文本
              </button>
            `
            : props.content
              ? html`<div class="sidebar-markdown">${until(
                  toSanitizedMarkdownHtmlAsync(props.content).then((htmlStr) =>
                    unsafeHTML(htmlStr),
                  ),
                  html`
                    <span class="chat-loading-markdown">...</span>
                  `,
                )}</div>`
              : html`
                  <div class="muted">暂无内容</div>
                `
        }
      </div>
    </div>
  `;
}
