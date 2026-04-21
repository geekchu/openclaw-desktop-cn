import fs from "node:fs/promises";
import path from "node:path";

type GatewayStartupStateKind = "starting" | "ready" | "failed";

type GatewayStartupStateRecord = {
  runId: string;
  pid: number;
  port: number;
  state: GatewayStartupStateKind;
  updatedAt: number;
  phase?: string;
  error?: string;
};

function resolveGatewayStartupStatePath(stateDir = process.env.OPENCLAW_STATE_DIR): string | null {
  const resolved = typeof stateDir === "string" ? stateDir.trim() : "";
  if (resolved.length === 0) {
    return null;
  }
  return path.join(resolved, "gateway-startup-state.json");
}

async function writeGatewayStartupStateRecord(
  record: GatewayStartupStateRecord,
  stateDir = process.env.OPENCLAW_STATE_DIR,
): Promise<void> {
  const targetPath = resolveGatewayStartupStatePath(stateDir);
  if (!targetPath) {
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(record)}\n`, "utf-8");
  await fs.rename(tempPath, targetPath);
}

function formatStartupError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createGatewayStartupStateTracker(params: {
  runId?: string | null;
  port: number;
  stateDir?: string;
}) {
  const runId = typeof params.runId === "string" ? params.runId.trim() : "";
  const stateDir = params.stateDir;
  let writesDisabled = false;
  const writeState = async (
    state: GatewayStartupStateKind,
    options: {
      phase?: string;
      error?: string;
    } = {},
  ) => {
    if (runId.length === 0 || writesDisabled) {
      return;
    }
    try {
      await writeGatewayStartupStateRecord(
        {
          runId,
          pid: process.pid,
          port: params.port,
          state,
          updatedAt: Date.now(),
          ...(typeof options.phase === "string" && options.phase.length > 0
            ? { phase: options.phase }
            : {}),
          ...(typeof options.error === "string" && options.error.length > 0
            ? { error: options.error }
            : {}),
        },
        stateDir,
      );
    } catch (error) {
      writesDisabled = true;
      console.warn(`gateway startup state tracking disabled: ${formatStartupError(error)}`);
    }
  };

  return {
    markPhase: async (phase: string) => {
      await writeState("starting", { phase });
    },
    markReady: async () => {
      await writeState("ready", { phase: "ready" });
    },
    markFailed: async (error: unknown, phase?: string) => {
      await writeState("failed", {
        phase,
        error: formatStartupError(error),
      });
    },
  };
}
