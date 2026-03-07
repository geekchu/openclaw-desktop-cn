import { html } from "lit";

export type ManagerProps = {
  active: boolean;
};

// ── 模块级状态 ──
let _iframe: HTMLIFrameElement | null = null;
let _mountedContainer: HTMLElement | null = null;
let _preloadScheduled = false;

function ensureIframe(container: HTMLElement) {
  if (_mountedContainer === container && _iframe) {
    return;
  }

  // 清理旧 iframe
  if (_iframe && _iframe.parentElement) {
    _iframe.parentElement.removeChild(_iframe);
  }

  const iframe = document.createElement("iframe");
  iframe.src = "/manager/";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.style.display = "block";
  iframe.setAttribute("allow", "clipboard-read; clipboard-write");

  container.appendChild(iframe);
  _iframe = iframe;
  _mountedContainer = container;
}

export function renderManager(props: ManagerProps) {
  // 始终渲染容器 div（保持 iframe 存活），通过 CSS 控制可见性
  const hiddenStyle = props.active ? "display: flex; flex: 1; min-height: 0;" : "display: none;";

  // 无论是否激活，首次渲染时就预加载 iframe（用户感觉不到延迟）
  if (!_preloadScheduled) {
    _preloadScheduled = true;
    setTimeout(() => {
      const container = document.getElementById("manager-container");
      if (container) {
        ensureIframe(container);
      }
    }, 100);
  }

  return html`
    <div id="manager-container" class="manager-container" style="${hiddenStyle}"></div>
  `;
}
