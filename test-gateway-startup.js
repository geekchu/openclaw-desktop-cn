import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bundleDir = path.join(__dirname, "src-tauri", "gateway-bundle");
const entry = path.join(bundleDir, "openclaw.mjs");

console.log("Starting test gateway at:", entry);

const child = spawn(
  process.execPath,
  [entry, "gateway", "--port", "18789", "--bind", "loopback", "--desktop-internal", "--force"],
  {
    cwd: bundleDir,
    env: {
      ...process.env,
      OPENCLAW_DESKTOP: "1",
      OPENCLAW_NO_RESPAWN: "1",
      OPENCLAW_GATEWAY_TOKEN: "test-token",
      OPENCLAW_STATE_DIR: path.join(__dirname, ".test-state"),
      DEBUG: "openclaw:*",
      OPENCLAW_LOG_LEVEL: "debug",
    },
  },
);

child.stdout.on("data", (d) => {
  process.stdout.write("[STDOUT] " + d.toString());
});

child.stderr.on("data", (d) => {
  process.stderr.write("[STDERR] " + d.toString());
});

child.on("close", (code) => {
  console.log(`Child exited with code ${code}`);
  process.exit(code);
});

// kill after 30 seconds
setTimeout(() => {
  console.log("Timeout reached, killing...");
  child.kill();
}, 30000);
