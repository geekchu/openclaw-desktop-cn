import { spawn } from "node:child_process";
import type { GatewayRequestHandlers } from "./types.js";
import { runExec } from "../../process/exec.js";

async function isDockerDaemonRunning(): Promise<boolean> {
  try {
    await runExec("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeoutMs: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function isDockerInstalled(): Promise<boolean> {
  try {
    await runExec("docker", ["--version"], { timeoutMs: 3_000 });
    return true;
  } catch {
    return false;
  }
}

function startDockerDesktop(): boolean {
  if (process.platform === "win32") {
    // On Windows, Docker Desktop may be installed anywhere — don't guess the path.
    return false;
  } else if (process.platform === "darwin") {
    const child = spawn("open", ["-a", "Docker"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  } else {
    // Linux: try systemctl
    const child = spawn("systemctl", ["--user", "start", "docker-desktop"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  }
}

async function waitForDocker(maxWaitMs: number): Promise<boolean> {
  const start = Date.now();
  const interval = 2_000;
  while (Date.now() - start < maxWaitMs) {
    if (await isDockerDaemonRunning()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

export const dockerHandlers: GatewayRequestHandlers = {
  "docker.check": async ({ respond }) => {
    // Fast path: daemon already running
    if (await isDockerDaemonRunning()) {
      respond(true, { available: true }, undefined);
      return;
    }

    // Docker CLI exists but daemon not running → try auto-start (non-Windows)
    if (await isDockerInstalled()) {
      const launched = startDockerDesktop();
      if (!launched) {
        // Windows: can't auto-start, tell UI to prompt the user
        respond(true, { available: false, installed: true }, undefined);
        return;
      }
      const ready = await waitForDocker(30_000);
      respond(true, { available: ready, installed: true, autoStarted: ready }, undefined);
      return;
    }

    // Docker not installed at all
    respond(true, { available: false, installed: false }, undefined);
  },
};
