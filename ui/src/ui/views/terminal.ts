import { html, nothing } from "lit";

export type TerminalProps = {
  active: boolean;
  gatewayUrl: string;
};

// ── 模块级状态 ──
let _terminal: any = null;
let _fitAddon: any = null;
let _sessionId: string | null = null;
let _unlistenOutput: (() => void) | null = null;
let _unlistenExit: (() => void) | null = null;
let _currentContainer: HTMLElement | null = null;
let _resizeObserver: ResizeObserver | null = null;
// 防止并发初始化 / attachSession
let _initBusy = false;
let _attachBusy = false;
// 防止重复 resize
let _lastCols = 0;
let _lastRows = 0;
let _fitTimer: ReturnType<typeof setTimeout> | null = null;
let _lastContainerW = 0;
let _lastContainerH = 0;
// resize 冷却期（防止 ConPTY 重绘导致循环）
let _resizeCooldown = false;

const SESSION_STORAGE_KEY = "openclaw-terminal-session-id";

function saveSessionId(id: string | null) {
  _sessionId = id;
  if (id) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, id);
  } else {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function restoreSessionId() {
  if (!_sessionId) {
    _sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  }
}

function getTauri(): any {
  const w = window as any;
  return w.__TAURI__ ?? null;
}

async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = getTauri();
  if (tauri?.core?.invoke) {
    return tauri.core.invoke(cmd, args);
  }
  throw new Error("Tauri invoke not available");
}

// 等待容器获得实际尺寸（flex 布局完成后）
function waitForLayout(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        resolve();
      } else if (++attempts < 50) {
        requestAnimationFrame(check);
      } else {
        resolve();
      }
    };
    check();
  });
}

// xterm 主题（GitHub Dark 风格）
const THEME = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#e74c5e",
  selectionBackground: "rgba(56, 139, 253, 0.3)",
  selectionForeground: "#ffffff",
  black: "#0d1117",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#c9d1d9",
  brightBlack: "#484f58",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

// ── 清理辅助 ──

function cleanupResizeObserver() {
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
}

function observeResize(container: HTMLElement) {
  cleanupResizeObserver();
  // 记录初始尺寸
  _lastContainerW = container.clientWidth;
  _lastContainerH = container.clientHeight;

  _resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    if (_resizeCooldown) return;

    // 仅在容器像素变化 >20px 时才重新 fit（排除滚动条出现/消失导致的微小变化）
    const dw = Math.abs(w - _lastContainerW);
    const dh = Math.abs(h - _lastContainerH);
    if (dw < 20 && dh < 20) return;

    _lastContainerW = w;
    _lastContainerH = h;

    if (_fitTimer) clearTimeout(_fitTimer);
    _fitTimer = setTimeout(() => {
      _resizeCooldown = true;
      try {
        _fitAddon?.fit();
      } catch {
        /* ignore */
      }
      // 冷却 500ms，防止 ConPTY 重绘触发新一轮 resize
      setTimeout(() => {
        _resizeCooldown = false;
      }, 500);
    }, 150);
  });
  _resizeObserver.observe(container);
}

function disposeTerminal() {
  cleanupResizeObserver();
  if (_unlistenOutput) {
    _unlistenOutput();
    _unlistenOutput = null;
  }
  if (_unlistenExit) {
    _unlistenExit();
    _unlistenExit = null;
  }
  if (_terminal) {
    try {
      _terminal.dispose();
    } catch {
      /* ignore */
    }
    _terminal = null;
  }
  _fitAddon = null;
  _currentContainer = null;
}

// 过滤 ConPTY 可能发送的清除滚动缓冲区序列
function filterOutput(data: string): string {
  return data
    .replace(/\x1b\[3J/g, "") // ED3: 清除滚动缓冲区
    .replace(/\x1b\[\?1049[hl]/g, ""); // 备用屏幕缓冲区切换
}

// ── PTY 会话管理 ──

async function attachSession() {
  if (_attachBusy) return;
  _attachBusy = true;

  if (_unlistenOutput) {
    _unlistenOutput();
    _unlistenOutput = null;
  }
  if (_unlistenExit) {
    _unlistenExit();
    _unlistenExit = null;
  }

  const term = _terminal;
  if (!term) {
    _attachBusy = false;
    return;
  }

  try {
    const tauri = getTauri();
    const earlyEvents: Array<{ id: string; data: string }> = [];
    let ready = false;

    if (tauri?.event?.listen) {
      _unlistenOutput = await tauri.event.listen("terminal-output", (event: any) => {
        const payload = event.payload;
        if (!payload?.data) return;
        if (ready && payload.id === _sessionId) {
          term.write(filterOutput(payload.data));
        } else if (!ready) {
          earlyEvents.push({ id: payload.id, data: filterOutput(payload.data) });
        }
      });
      _unlistenExit = await tauri.event.listen("terminal-exit", (event: any) => {
        const exitId = typeof event.payload === "string" ? event.payload : event.payload?.id;
        if (exitId === _sessionId) {
          term.writeln("\r\n\x1b[90m会话已结束，按任意键重启\x1b[0m");
          saveSessionId(null);
          updateStatusIndicator("exited");
        }
      });
    }

    _sessionId = await invoke("terminal_create", {
      cols: term.cols || 80,
      rows: term.rows || 24,
    });
    saveSessionId(_sessionId);
    _lastCols = term.cols || 80;
    _lastRows = term.rows || 24;

    for (const ev of earlyEvents) {
      if (ev.id === _sessionId) {
        term.write(ev.data);
      }
    }
    ready = true;
    updateStatusIndicator("connected");
  } catch (e: any) {
    term.writeln(`\x1b[31m创建终端失败: ${e}\x1b[0m`);
    updateStatusIndicator("error");
  } finally {
    _attachBusy = false;
  }
}

// 重新连接到已有的 PTY 会话（tab 切换回来时 / 页面刷新后）
// 返回 true 表示成功，false 表示会话已不存在
async function reattachSession(term: any): Promise<boolean> {
  if (_unlistenOutput) {
    _unlistenOutput();
    _unlistenOutput = null;
  }
  if (_unlistenExit) {
    _unlistenExit();
    _unlistenExit = null;
  }

  const tauri = getTauri();
  if (tauri?.event?.listen) {
    _unlistenOutput = await tauri.event.listen("terminal-output", (event: any) => {
      const payload = event.payload;
      if (!payload?.data) return;
      if (payload.id === _sessionId) {
        term.write(filterOutput(payload.data));
      }
    });
    _unlistenExit = await tauri.event.listen("terminal-exit", (event: any) => {
      const exitId = typeof event.payload === "string" ? event.payload : event.payload?.id;
      if (exitId === _sessionId) {
        term.writeln("\r\n\x1b[90m会话已结束，按任意键重启\x1b[0m");
        saveSessionId(null);
        updateStatusIndicator("exited");
      }
    });
  }

  // 尝试 resize 验证会话是否存活
  const cols = term.cols || 80;
  const rows = term.rows || 24;
  try {
    await invoke("terminal_resize", {
      id: _sessionId,
      cols,
      rows,
    });
    _lastCols = cols;
    _lastRows = rows;
    updateStatusIndicator("connected");
    return true;
  } catch {
    // 会话已不存在，清除过期 ID
    saveSessionId(null);
    return false;
  }
}

// ── 状态指示器 ──

function updateStatusIndicator(status: "connected" | "exited" | "error") {
  const dot = document.getElementById("terminal-status-dot");
  const text = document.getElementById("terminal-status-text");
  if (!dot || !text) return;
  dot.className = "terminal-status__dot";
  switch (status) {
    case "connected":
      dot.classList.add("terminal-status__dot--ok");
      text.textContent = _sessionId ?? "已连接";
      break;
    case "exited":
      dot.classList.add("terminal-status__dot--exited");
      text.textContent = "已退出";
      break;
    case "error":
      dot.classList.add("terminal-status__dot--error");
      text.textContent = "错误";
      break;
  }
}

// ── 创建全新 xterm 实例并挂载到容器 ──

async function createTerminalInstance(container: HTMLElement) {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
  ]);

  const fitAddon = new FitAddon();
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    lineHeight: 1.2,
    fontFamily:
      "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
    scrollback: 5000,
    theme: THEME,
  });

  term.loadAddon(fitAddon);

  try {
    const { Unicode11Addon } = await import("@xterm/addon-unicode11");
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
  } catch {
    /* ignore */
  }

  term.open(container);
  fitAddon.fit();

  _terminal = term;
  _fitAddon = fitAddon;
  _currentContainer = container;

  term.onResize((size: { cols: number; rows: number }) => {
    if (_sessionId && (size.cols !== _lastCols || size.rows !== _lastRows)) {
      _lastCols = size.cols;
      _lastRows = size.rows;
      invoke("terminal_resize", { id: _sessionId, cols: size.cols, rows: size.rows }).catch(
        () => {},
      );
    }
  });

  observeResize(container);

  term.onData((data: string) => {
    if (_sessionId) {
      invoke("terminal_write", { id: _sessionId, data }).catch(() => {});
    } else {
      void attachSession();
    }
  });

  return term;
}

// ── 主入口：initTerminal ──

async function initTerminal(container: HTMLElement) {
  // 如果终端已经挂载在同一个容器上，直接跳过（防止 lit 重渲染导致反复销毁重建）
  if (_terminal && _currentContainer === container) return;
  if (_initBusy) return;

  _initBusy = true;
  try {
    await waitForLayout(container);

    // 销毁旧 xterm DOM（不销毁 PTY 会话）
    cleanupResizeObserver();
    if (_unlistenOutput) {
      _unlistenOutput();
      _unlistenOutput = null;
    }
    if (_unlistenExit) {
      _unlistenExit();
      _unlistenExit = null;
    }
    if (_terminal) {
      try {
        _terminal.dispose();
      } catch {
        /* ignore */
      }
      _terminal = null;
    }
    _fitAddon = null;
    _currentContainer = null;

    // 创建全新 xterm 实例
    const term = await createTerminalInstance(container);

    // 恢复页面刷新前的会话 ID
    restoreSessionId();

    if (_sessionId) {
      // PTY 会话可能仍存活 → 尝试重新连接
      const ok = await reattachSession(term);
      if (!ok) {
        // 会话已失效 → 创建新 PTY 会话
        await attachSession();
      }
    } else {
      // 无活跃会话 → 创建新 PTY 会话
      await attachSession();
    }

    term.focus();
  } finally {
    _initBusy = false;
  }
}

// ── 工具栏操作 ──

function handleClear() {
  _terminal?.clear();
  _terminal?.focus();
}

async function handleRestart() {
  if (_sessionId && _terminal) {
    const isWindows = navigator.platform.toLowerCase().includes("win");
    const clearCmd = isWindows ? "cls" : "clear";
    await invoke("terminal_write", { id: _sessionId, data: clearCmd + "\r" }).catch(() => {});
    _terminal.focus();
    return;
  }
  _terminal?.clear();
  _terminal?.writeln("\x1b[90m正在启动终端...\x1b[0m\r\n");
  updateStatusIndicator("exited");
  if (_terminal) {
    await attachSession();
  }
}

// ── 渲染 ──

export function renderTerminal(props: TerminalProps) {
  if (!props.active) {
    return nothing;
  }

  setTimeout(() => {
    const container = document.getElementById("terminal-container");
    if (container) {
      void initTerminal(container);
    }
  }, 50);

  return html`
    <div class="terminal-page">
      <div class="terminal-toolbar">
        <div class="terminal-toolbar__left">
          <div class="terminal-status">
            <span id="terminal-status-dot" class="terminal-status__dot ${_sessionId ? "terminal-status__dot--ok" : ""}"></span>
            <span id="terminal-status-text" class="terminal-status__label">${_sessionId ?? "终端"}</span>
          </div>
        </div>
        <div class="terminal-toolbar__actions">
          <button class="terminal-toolbar__btn" @click=${handleClear} title="清屏">
            <svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
            清屏
          </button>
          <button class="terminal-toolbar__btn terminal-toolbar__btn--restart" @click=${handleRestart} title="重启终端">
            <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            重启
          </button>
        </div>
      </div>
      <div id="terminal-container" class="terminal-container"></div>
    </div>
  `;
}
