import type { DaemonLifecycleOptions } from "./types.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { defaultRuntime } from "../../runtime.js";
import {
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
} from "./lifecycle-core.js";
import { renderGatewayServiceStartHints } from "./shared.js";

export async function runDaemonUninstall(opts: DaemonLifecycleOptions = {}) {
  if (process.env.OPENCLAW_DESKTOP_TERMINAL === "1") {
    defaultRuntime.error("桌面版不支持 uninstall 服务命令，请通过系统卸载。");
    defaultRuntime.exit(1);
    return;
  }
  return await runServiceUninstall({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
    stopBeforeUninstall: true,
    assertNotLoadedAfterUninstall: true,
  });
}

export async function runDaemonStart(opts: DaemonLifecycleOptions = {}) {
  return await runServiceStart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
  });
}

export async function runDaemonStop(opts: DaemonLifecycleOptions = {}) {
  if (process.env.OPENCLAW_DESKTOP_TERMINAL === "1") {
    defaultRuntime.error("桌面版不支持 stop 服务命令，gateway 由桌面端管理。");
    defaultRuntime.exit(1);
    return;
  }
  return await runServiceStop({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
  });
}

/**
 * Restart the gateway service service.
 * @returns `true` if restart succeeded, `false` if the service was not loaded.
 * Throws/exits on check or restart failures.
 */
export async function runDaemonRestart(opts: DaemonLifecycleOptions = {}): Promise<boolean> {
  if (process.env.OPENCLAW_DESKTOP_TERMINAL === "1") {
    defaultRuntime.error("桌面版不支持 restart 服务命令，gateway 由桌面端管理。");
    defaultRuntime.exit(1);
    return false;
  }
  return await runServiceRestart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
  });
}
