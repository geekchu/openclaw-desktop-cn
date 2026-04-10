// ── 更新模块 ──
// 手动检查更新 API，供系统设置页面调用
// 使用 Tauri v2 plugin-updater API (Channel + rid 模式)

type UpdateMetadata = {
  version?: string;
  body?: string;
};

type UpdateProgressEvent =
  | {
      event: "Started";
      data?: { contentLength?: number };
    }
  | {
      event: "Progress";
      data?: { chunkLength?: number };
    }
  | {
      event: "Finished";
      data?: Record<string, never>;
    };

type TauriChannel = {
  onmessage?: ((event: UpdateProgressEvent) => void | Promise<void>) | null;
};

type TauriCore = {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  Channel: new () => TauriChannel;
};

type TauriGlobal = {
  core?: TauriCore;
};

function getTauri(): TauriGlobal | null {
  return (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/** 检查更新的结果类型 */
export type CheckUpdateResult =
  | { status: "available"; version: string; body: string; rid: number }
  | { status: "up-to-date" }
  | { status: "error"; message: string };

/**
 * 手动检查更新，供系统设置页面调用。
 * 返回明确的状态：available（有更新）、up-to-date（已是最新）、error（检查失败）
 */
export async function checkForUpdate(): Promise<CheckUpdateResult> {
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    return { status: "error", message: "Tauri API 不可用" };
  }

  try {
    const result = (await tauri.core.invoke("desktop_check_for_update")) as UpdateMetadata | null;
    if (result == null) {
      // null 表示没有可用更新（已是最新版本）
      return { status: "up-to-date" };
    }

    return {
      status: "available",
      version: result.version || "未知",
      body: result.body || "",
      // 保留 rid 形状，避免系统设置页面大改；真实状态已由 Rust 侧托管。
      rid: 1,
    };
  } catch (error: unknown) {
    // 网络错误、服务器不可达、JSON 解析失败等
    return { status: "error", message: getErrorMessage(error) };
  }
}

/**
 * 关闭更新资源，释放 Tauri 侧的 rid。
 * 在组件卸载或重新检查前调用，防止资源泄漏。
 */
export async function closeUpdateResource(rid: number): Promise<void> {
  void rid;
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    return;
  }
  try {
    await tauri.core.invoke("desktop_clear_pending_update");
  } catch {
    // ignore - 状态可能已被清理
  }
}

/**
 * 关闭 download 返回的 bytesRid 资源。
 * 对齐 Tauri 官方 guest-js 的 Update.close() 语义，避免重复检查/卸载组件时泄漏资源。
 */
export async function closeDownloadedBytesResource(rid: number): Promise<void> {
  void rid;
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    return;
  }
  try {
    await tauri.core.invoke("desktop_clear_downloaded_update");
  } catch {
    // ignore - 状态可能已被清理
  }
}

/**
 * 下载更新，供系统设置页面调用。
 * @param rid - check 返回的资源 ID
 * @param onProgress - 进度回调 (0-100)
 */
export async function downloadUpdate(
  rid: number,
  onProgress?: (percent: number) => void,
): Promise<number> {
  void rid;
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    throw new Error("Tauri API 不可用");
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  const channel = new tauri.core.Channel();
  // eslint-disable-next-line unicorn/prefer-add-event-listener
  channel.onmessage = async (event: UpdateProgressEvent) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data?.contentLength ?? 0;
        downloadedBytes = 0;
        break;
      case "Progress":
        downloadedBytes += event.data?.chunkLength ?? 0;
        if (totalBytes > 0 && onProgress) {
          onProgress(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
        }
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  };

  await tauri.core.invoke("desktop_download_update", {
    onEvent: channel,
  });
  // 保留 bytesRid 形状，避免系统设置页大改；真实字节缓冲由 Rust 侧托管。
  return 2;
}

/**
 * 安装已下载的更新。这通常会导致应用退出（Windows 下）。
 * @param updateRid - check 返回的更新资源 ID
 * @param bytesRid - download 返回的字节资源 ID
 */
export async function installUpdate(updateRid: number, bytesRid: number): Promise<void> {
  void updateRid;
  void bytesRid;
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    throw new Error("Tauri API 不可用");
  }

  await tauri.core.invoke("desktop_install_update");
}
