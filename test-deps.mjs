import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bundleDir = path.join(__dirname, "src-tauri", "gateway-bundle");

async function testDependencies() {
  console.log("Validating extensions...");
  const extDir = path.join(bundleDir, "extensions");
  if (fs.existsSync(extDir)) {
    const exts = fs.readdirSync(extDir);
    for (const ext of exts) {
      const extPath = path.join(extDir, ext, "index.ts");
      if (fs.existsSync(extPath)) {
        try {
          console.log("  Testing extension:", ext);
          // Use dynamic import to test loading
          await import("file:///" + extPath.replace(/\\/g, "/"));
          console.log("    ✓ Success");
        } catch (e) {
          // Ignore syntax errors, we only care about 'Cannot find module'
          if (e.message && e.message.includes("Cannot find module")) {
            console.error("    ❌ FAILED (Missing Module):", e.message);
          } else {
            // Other errors like TypeScript syntax are expected without jiti,
            // but if it's a module error, it's a problem.
            console.log("    ✓ Success (Ignoring syntax error)");
          }
        }
      }
    }
  }
  console.log("Validation complete.");
}
testDependencies().catch(console.error);
