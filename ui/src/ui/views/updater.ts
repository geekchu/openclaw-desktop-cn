// ── 自动更新模块 ──
// 自包含模块：管理自己的 DOM 横幅，无需修改主渲染管线
// 使用 Tauri v2 plugin-updater API (Channel + rid 模式)

function getTauri(): any {
  return (window as any).__TAURI__ ?? null;
}

let _bannerEl: HTMLElement | null = null;
let _dismissed = false;
let _initialized = false;
let _updateRid: number | null = null; // 保存 check 返回的资源 ID

function ensureBanner(): HTMLElement {
  if (_bannerEl) return _bannerEl;
  _bannerEl = document.createElement("div");
  _bannerEl.id = "update-banner";
  _bannerEl.className = "update-banner";
  _bannerEl.style.display = "none";
  document.body.appendChild(_bannerEl);
  return _bannerEl;
}

function showBanner(version: string, notes: string) {
  if (_dismissed) return;
  const banner = ensureBanner();
  const notesHtml = notes ? `<div class="update-banner__notes">${escapeHtml(notes)}</div>` : "";
  banner.innerHTML = `
    <div class="update-banner__content">
      <span class="update-banner__icon">🎉</span>
      <span>发现新版本 <strong>v${escapeHtml(version)}</strong></span>
      <button class="update-banner__btn" id="update-btn">立即更新</button>
      <button class="update-banner__dismiss" id="update-dismiss" title="稍后再说">✕</button>
    </div>
    ${notesHtml}
  `;
  banner.style.display = "";
  banner.classList.remove("update-banner--downloading");

  document.getElementById("update-btn")?.addEventListener("click", () => {
    void doUpdate(version);
  });
  document.getElementById("update-dismiss")?.addEventListener("click", () => {
    _dismissed = true;
    banner.style.display = "none";
  });
}

function showDownloading(version: string, percent: number) {
  const banner = ensureBanner();
  banner.innerHTML = `
    <div class="update-banner__content">
      <span class="update-banner__icon">⬇️</span>
      <span>正在下载更新 v${escapeHtml(version)}...</span>
      <div class="update-banner__progress">
        <div class="update-banner__progress-bar" style="width: ${percent}%"></div>
      </div>
      <span class="update-banner__percent">${percent}%</span>
    </div>
  `;
  banner.style.display = "";
  banner.classList.add("update-banner--downloading");
}

function showError(msg: string) {
  const banner = ensureBanner();
  banner.innerHTML = `
    <div class="update-banner__content">
      <span class="update-banner__icon">❌</span>
      <span>更新失败：${escapeHtml(msg)}</span>
      <button class="update-banner__dismiss" id="update-dismiss-err" title="关闭">✕</button>
    </div>
  `;
  banner.style.display = "";
  banner.classList.remove("update-banner--downloading");
  document.getElementById("update-dismiss-err")?.addEventListener("click", () => {
    banner.style.display = "none";
  });
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function doUpdate(version: string) {
  const tauri = getTauri();
  if (!tauri?.core?.invoke || _updateRid == null) return;

  try {
    showDownloading(version, 0);
    let totalBytes = 0;
    let downloadedBytes = 0;

    // 使用 Tauri v2 Channel API 替代 transformCallback
    const channel = new tauri.core.Channel();
    channel.onmessage = (event: any) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength || 0;
          downloadedBytes = 0;
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength || 0;
          if (totalBytes > 0) {
            showDownloading(version, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          }
          break;
        case "Finished":
          showDownloading(version, 100);
          break;
      }
    };

    await tauri.core.invoke("plugin:updater|download_and_install", {
      onEvent: channel,
      rid: _updateRid,
    });

    // 安装完成，显示重启确认（而非直接重启）
    const banner = ensureBanner();
    banner.innerHTML = `
      <div class="update-banner__content">
        <span class="update-banner__icon">✅</span>
        <span>更新已下载完成，重启后生效</span>
        <button class="update-banner__btn" id="update-restart-btn">立即重启</button>
        <button class="update-banner__dismiss" id="update-restart-later" title="稍后重启">稍后</button>
      </div>
    `;
    banner.style.display = "";
    banner.classList.remove("update-banner--downloading");
    document.getElementById("update-restart-btn")?.addEventListener("click", () => {
      tauri.core.invoke("plugin:process|restart");
    });
    document.getElementById("update-restart-later")?.addEventListener("click", () => {
      banner.style.display = "none";
    });
  } catch (e: any) {
    console.error("[Updater] 更新失败:", e);
    showError(String(e?.message || e));
  }
}

/**
 * 导出手动检查更新，供系统设置页面调用。
 * 返回 { available, version, body, rid } 或 null
 */
export async function checkForUpdate(): Promise<{
  available: boolean;
  version: string;
  body: string;
  rid: number;
} | null> {
  const tauri = getTauri();
  if (!tauri?.core?.invoke) return null;

  const result = await tauri.core.invoke("plugin:updater|check");
  if (result == null) return null;

  // Tauri v2 返回 UpdateMetadata: { rid, currentVersion, version, date?, body?, rawJson }
  return {
    available: true,
    version: result.version || "未知",
    body: result.body || "",
    rid: result.rid,
  };
}

/**
 * 导出下载并安装更新，供系统设置页面调用。
 * @param rid - check 返回的资源 ID
 * @param onProgress - 进度回调 (0-100)
 */
export async function downloadAndInstallUpdate(
  rid: number,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const tauri = getTauri();
  if (!tauri?.core?.invoke) throw new Error("Tauri API 不可用");

  let totalBytes = 0;
  let downloadedBytes = 0;

  const channel = new tauri.core.Channel();
  channel.onmessage = (event: any) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data.contentLength || 0;
        downloadedBytes = 0;
        break;
      case "Progress":
        downloadedBytes += event.data.chunkLength || 0;
        if (totalBytes > 0 && onProgress) {
          onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
        }
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  };

  await tauri.core.invoke("plugin:updater|download_and_install", {
    onEvent: channel,
    rid,
  });
  // 安装完成，不自动重启 — 让调用方决定何时重启
}

/**
 * 初始化自动更新检查。
 * 在应用启动后调用一次即可。延迟 5 秒开始检查。
 */
export function initAutoUpdater() {
  if (_initialized) return;
  _initialized = true;

  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    console.log("[Updater] Tauri API 不可用，跳过更新检查");
    return;
  }

  const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 小时
  const RETRY_DELAY = 30 * 60 * 1000;         // 30 分钟
  let _retried = false;

  async function doCheck() {
    try {
      console.log("[Updater] 正在检查更新...");
      // 释放旧的更新资源
      if (_updateRid != null) {
        try {
          await tauri.core.invoke("plugin:updater|close", { rid: _updateRid });
        } catch { /* ignore */ }
        _updateRid = null;
      }

      const update = await checkForUpdate();
      if (update) {
        console.log(`[Updater] 发现新版本: ${update.version}`);
        _updateRid = update.rid;
        showBanner(update.version, update.body);
      } else {
        console.log("[Updater] 当前已是最新版本");
      }
      _retried = false; // 成功后重置重试标记
    } catch (e: any) {
      console.warn("[Updater] 检查更新失败:", e);
      // 失败后 30 分钟重试一次（仅一次）
      if (!_retried) {
        _retried = true;
        setTimeout(doCheck, RETRY_DELAY);
        return;
      }
      _retried = false;
    }
    setTimeout(doCheck, CHECK_INTERVAL);
  }

  // 延迟首次检查，避免与页面初始化渲染竞争
  setTimeout(() => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => doCheck(), { timeout: 30000 });
    } else {
      doCheck();
    }
  }, 15000);
}
