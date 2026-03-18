// ── 更新模块 ──
// 手动检查更新 API，供系统设置页面调用
// 使用 Tauri v2 plugin-updater API (Channel + rid 模式)

function getTauri(): any {
  return (window as any).__TAURI__ ?? null;
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
    const result = await tauri.core.invoke("plugin:updater|check");
    if (result == null) {
      // Tauri v2 updater: null 表示没有可用更新（已是最新版本）
      return { status: "up-to-date" };
    }

    // Tauri v2 返回 UpdateMetadata: { rid, currentVersion, version, date?, body?, rawJson }
    return {
      status: "available",
      version: result.version || "未知",
      body: result.body || "",
      rid: result.rid,
    };
  } catch (e: any) {
    // 网络错误、服务器不可达、JSON 解析失败等
    return { status: "error", message: String(e?.message || e) };
  }
}

/**
 * 关闭更新资源，释放 Tauri 侧的 rid。
 * 在组件卸载或重新检查前调用，防止资源泄漏。
 */
export async function closeUpdateResource(rid: number): Promise<void> {
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    return;
  }
  try {
    await tauri.core.invoke("plugin:updater|close", { rid });
  } catch {
    // ignore - 资源可能已被释放
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
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    throw new Error("Tauri API 不可用");
  }

  let totalBytes = 0;
  let downloadedBytes = 0;

  const channel = new tauri.core.Channel();
  channel.onmessage = async (event: any) => {
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

  const bytesRid = await tauri.core.invoke("plugin:updater|download", {
    onEvent: channel,
    rid,
  });
  return bytesRid as number;
}

/**
 * 安装已下载的更新。这通常会导致应用退出（Windows 下）。
 * @param updateRid - check 返回的更新资源 ID
 * @param bytesRid - download 返回的字节资源 ID
 */
export async function installUpdate(updateRid: number, bytesRid: number): Promise<void> {
  const tauri = getTauri();
  if (!tauri?.core?.invoke) {
    throw new Error("Tauri API 不可用");
  }

  await tauri.core.invoke("plugin:updater|install", {
    updateRid,
    bytesRid,
  });
}
