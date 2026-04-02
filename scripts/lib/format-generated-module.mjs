import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[\r\n]/;

function quoteWindowsCmdArg(value) {
  if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(value)) {
    throw new Error(`unsafe Windows formatter argument: ${JSON.stringify(value)}`);
  }
  if (!value) {
    return '""';
  }
  const escaped = value.replace(/"/g, '\\"').replace(/%/g, "%%").replace(/!/g, "^!");
  if (!/[ \t"&|<>^()%!]/u.test(value)) {
    return escaped;
  }
  return `"${escaped}"`;
}

function spawnFormatter(command, args, options) {
  if (process.platform !== "win32") {
    return spawnSync(command, args, options);
  }
  const quotedCommand = quoteWindowsCmdArg(command);
  const commandLineInner = [quotedCommand, ...args.map(quoteWindowsCmdArg)].join(" ");
  const commandLine = quotedCommand.startsWith('"')
    ? `"${commandLineInner}"`
    : commandLineInner;
  return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

export function formatGeneratedModule(source, { repoRoot, outputPath, errorLabel }) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedOutputPath = path.resolve(
    resolvedRepoRoot,
    path.isAbsolute(outputPath) ? path.relative(resolvedRepoRoot, outputPath) : outputPath,
  );
  const directFormatterPath = path.join(resolvedRepoRoot, "node_modules", ".bin", "oxfmt");
  const directWindowsFormatterPath = `${directFormatterPath}.cmd`;
  const useDirectFormatter = process.platform === "win32"
    ? fs.existsSync(directWindowsFormatterPath)
    : fs.existsSync(directFormatterPath);
  const command = useDirectFormatter
    ? process.platform === "win32"
      ? directWindowsFormatterPath
      : directFormatterPath
    : process.platform === "win32"
      ? "pnpm.cmd"
      : "pnpm";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-generated-format-"));
  const tempOutputPath = path.join(tempDir, path.basename(resolvedOutputPath));

  try {
    fs.writeFileSync(tempOutputPath, source, "utf8");
    const args = useDirectFormatter
      ? ["--write", tempOutputPath]
      : ["exec", "oxfmt", "--write", tempOutputPath];
    const formatter = spawnFormatter(command, args, {
      cwd: resolvedRepoRoot,
      encoding: "utf8",
    });
    if (formatter.status !== 0) {
      const details =
        formatter.stderr?.trim() ||
        formatter.stdout?.trim() ||
        formatter.error?.message ||
        "unknown formatter failure";
      throw new Error(`failed to format generated ${errorLabel}: ${details}`);
    }
    return fs.readFileSync(tempOutputPath, "utf8");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
