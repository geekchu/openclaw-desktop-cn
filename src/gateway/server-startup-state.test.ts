import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayStartupStateTracker } from "./server-startup-state.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

async function readStartupState(tempDir: string) {
  const raw = await fs.readFile(path.join(tempDir, "gateway-startup-state.json"), "utf-8");
  return JSON.parse(raw) as {
    runId: string;
    pid: number;
    port: number;
    state: "starting" | "ready" | "failed";
    phase?: string;
    error?: string;
  };
}

afterEach(async () => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
  }
});

describe("gateway startup state tracker", () => {
  it("writes startup phase transitions for a desktop-managed run", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-startup-state-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    const tracker = createGatewayStartupStateTracker({
      runId: "desktop-run-1",
      port: 28789,
    });

    await tracker.markPhase("loading startup plugins");
    const starting = await readStartupState(tempDir);
    expect(starting).toMatchObject({
      runId: "desktop-run-1",
      port: 28789,
      state: "starting",
      phase: "loading startup plugins",
    });

    await tracker.markReady();
    const ready = await readStartupState(tempDir);
    expect(ready).toMatchObject({
      runId: "desktop-run-1",
      port: 28789,
      state: "ready",
      phase: "ready",
    });
  });

  it("records explicit startup failures", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-startup-state-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    const tracker = createGatewayStartupStateTracker({
      runId: "desktop-run-2",
      port: 28770,
    });

    await tracker.markFailed(new Error("canvas host bootstrap failed"), "starting HTTP server");
    const failed = await readStartupState(tempDir);
    expect(failed).toMatchObject({
      runId: "desktop-run-2",
      port: 28770,
      state: "failed",
      phase: "starting HTTP server",
      error: "canvas host bootstrap failed",
    });
  });
});
