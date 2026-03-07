import fs from "node:fs";
import json5 from "json5";
import { normalizeConfigPaths } from "../config/normalize-paths.js";
import { resolveConfigPath } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.js";
import { resolveUserPath } from "../utils.js";

type LoggingConfig = OpenClawConfig["logging"];

function hasPrivateUseChars(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    if (
      (codePoint >= 0xe000 && codePoint <= 0xf8ff) ||
      (codePoint >= 0xf0000 && codePoint <= 0xffffd) ||
      (codePoint >= 0x100000 && codePoint <= 0x10fffd)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeLoggingConfig(logging: LoggingConfig): LoggingConfig {
  const normalized = normalizeConfigPaths({ logging: { ...logging } } as OpenClawConfig)
    .logging ?? { ...logging };
  const file = normalized?.file;
  if (typeof file === "string") {
    const trimmed = file.trim();
    // Guard against icon-font/private-use glyphs being pasted into a path. Those
    // strings are not stable filesystem paths and can create garbage directories.
    if (!trimmed || hasPrivateUseChars(trimmed)) {
      delete normalized.file;
    } else {
      normalized.file = resolveUserPath(trimmed);
    }
  }
  return normalized;
}

export function readLoggingConfig(): LoggingConfig | undefined {
  const configPath = resolveConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return undefined;
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = json5.parse(raw);
    const logging = parsed?.logging;
    if (!logging || typeof logging !== "object" || Array.isArray(logging)) {
      return undefined;
    }
    return normalizeLoggingConfig(logging as LoggingConfig);
  } catch {
    return undefined;
  }
}
