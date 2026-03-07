import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveUserPath } from "../utils.js";
import { readLoggingConfig } from "./config.js";

describe("readLoggingConfig", () => {
  let tempDir: string;
  let originalStateDir: string | undefined;
  let originalTestFast: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-logging-config-"));
    originalStateDir = process.env.OPENCLAW_STATE_DIR;
    originalTestFast = process.env.OPENCLAW_TEST_FAST;
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_TEST_FAST = "1";
  });

  afterEach(async () => {
    if (originalStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = originalStateDir;
    }
    if (originalTestFast === undefined) {
      delete process.env.OPENCLAW_TEST_FAST;
    } else {
      process.env.OPENCLAW_TEST_FAST = originalTestFast;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("normalizes logging.file to an absolute path", async () => {
    await fs.writeFile(
      path.join(tempDir, "openclaw.json"),
      "{ logging: { file: '~/.openclawcn/logs/openclaw.log', level: 'debug' } }\n",
      "utf8",
    );

    const logging = readLoggingConfig();

    expect(logging?.level).toBe("debug");
    expect(logging?.file).toBe(resolveUserPath("~/.openclawcn/logs/openclaw.log"));
  });

  it("ignores logging.file values with private-use glyphs", async () => {
    await fs.writeFile(
      path.join(tempDir, "openclaw.json"),
      "{ logging: { file: 'C\uF03AUsersAdministrator.openclawlogs\\openclaw.log', level: 'info' } }\n",
      "utf8",
    );

    const logging = readLoggingConfig();

    expect(logging?.level).toBe("info");
    expect(logging?.file).toBeUndefined();
  });
});
