import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const bundleDir = join(projectRoot, "src-tauri", "gateway-bundle");
const artifactsDir = join(projectRoot, ".artifacts");

// Ensure artifacts dir exists
if (!existsSync(artifactsDir)) {
  mkdirSync(artifactsDir, { recursive: true });
}

// 1. Discover all extensions
console.log("[build-bundle] Discovering extensions...");
const extensionsDir = join(projectRoot, "extensions");
const extensions = [];
if (existsSync(extensionsDir)) {
  for (const ext of readdirSync(extensionsDir)) {
    const extPath = join(extensionsDir, ext);
    if (!existsSync(join(extPath, "package.json"))) {
      continue;
    }

    // We only bundle extensions that have a clear entry point
    const entryCandidates = ["index.ts", "index.js", "src/index.ts", "src/index.js"];
    const entry = entryCandidates.find((c) => existsSync(join(extPath, c)));

    if (entry) {
      extensions.push({ name: ext, entry: `../extensions/${ext}/${entry}` });
    }
  }
}

console.log(`[build-bundle] Found ${extensions.length} extensions to bundle statically.`);

// 2. Generate synthetic entry file
const syntheticEntryPath = join(artifactsDir, "gateway-bundle-entry.js");
let syntheticContent = `// Auto-generated entry point for single-file esbuild bundling
import '${join(projectRoot, "dist/warning-filter.js").replace(/\\/g, "/")}';

// Import all extensions to force them into the bundle
const __BUNDLED_EXTENSIONS__ = {};\n`;

for (let i = 0; i < extensions.length; i++) {
  const ext = extensions[i];
  // resolve absolute path for extension entry
  const absEntry = resolve(artifactsDir, ext.entry).replace(/\\/g, "/");
  syntheticContent += `import * as ext_${i} from '${absEntry}';\n`;
  syntheticContent += `__BUNDLED_EXTENSIONS__['${ext.name}'] = ext_${i};\n`;
}

syntheticContent += `\nglobalThis.__BUNDLED_EXTENSIONS__ = __BUNDLED_EXTENSIONS__;\n\n`;

// Finally import the main app entry
syntheticContent += `import '${join(projectRoot, "dist/entry.js").replace(/\\/g, "/")}';\n`;

writeFileSync(syntheticEntryPath, syntheticContent, "utf-8");

// 3. Clear target bundle dir but keep the skeleton
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
}
mkdirSync(bundleDir, { recursive: true });

// 4. Run esbuild
console.log("[build-bundle] Running esbuild...");

try {
  esbuild.buildSync({
    entryPoints: [syntheticEntryPath],
    bundle: true,
    outfile: join(bundleDir, "openclaw.mjs"),
    format: "esm",
    platform: "node",
    target: "node22",
    banner: {
      // Polyfill `require`, `__filename`, and `__dirname` in ESM format so CJS modules don't crash
      js: "import * as __esm_banner_module from 'module'; import * as __esm_banner_url from 'url'; import * as __esm_banner_path from 'path'; const require = __esm_banner_module.createRequire(import.meta.url); const __filename = __esm_banner_url.fileURLToPath(import.meta.url); const __dirname = __esm_banner_path.dirname(__filename);",
    },
    // Keep names to try to preserve __dirname as best as possible,
    // though realistically we depend on config dir resolution.
    keepNames: true,
    // Loader for native modules (.node), they will be copied next to the output
    loader: { ".node": "file" },
    // Externalize some binaries or dependencies that absolutely cannot be bundled
    external: [
      // If we encounter specific breaking packages like native os hooks
      // they should be added here, currently sqlite-vec is handled by the .node file loader.
      "fsevents",
      "ffmpeg-static",
      "@node-llama-cpp/*",
      "node-llama-cpp",
      "playwright-core",
    ],
  });
  console.log("[build-bundle] Bundle generated successfully.");
} catch (err) {
  console.error("[build-bundle] Esbuild failed:", err);
  process.exit(1);
}

// 5. Copy necessary runtime assets that aren't JS modules
console.log("[build-bundle] Copying runtime assets...");
// Ex: docs/reference/templates which is expected by the daemon/init
const copyTargets = ["docs/reference/templates", "assets", "skills"];

for (const target of copyTargets) {
  const srcDir = join(projectRoot, ...target.split("/"));
  const dstDir = join(bundleDir, ...target.split("/"));
  if (existsSync(srcDir)) {
    mkdirSync(dirname(dstDir), { recursive: true });
    if (process.platform === "win32") {
      try {
        execSync(`robocopy "${srcDir}" "${dstDir}" /E /NFL /NDL /NJH /NJS /NP`, {
          windowsHide: true,
        });
      } catch (err) {
        // robocopy exit codes: 0-7 = success (bitmask), >=8 = error
        if (err.status >= 8) {
          throw err;
        }
      }
    } else {
      execSync(`cp -R "${srcDir}" "${dstDir}"`);
    }
    console.log(`[build-bundle] Copied ${target}`);
  }
}

// We also need a fake package.json in the bundle folder so that OpenClaw's internal package.json reader doesn't crash
// Crucially, we MUST also define our external dependencies here so they can be installed separately for the bundle.
const rootPkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));

// Fetch versions for external dependencies from the root package.json or dependencies
const resolveVersion = (pkgName) => {
  return rootPkg.dependencies?.[pkgName] || rootPkg.devDependencies?.[pkgName] || "*";
};

const bundlePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: "module",
  main: "openclaw.mjs",
  dependencies: {
    "playwright-core": resolveVersion("playwright-core"),
    "ffmpeg-static": resolveVersion("ffmpeg-static"),
  },
  optionalDependencies: {},
};

// Clean out any wildcard externals that we couldn't properly resolve a single exact package for
for (const key of Object.keys(bundlePkg.dependencies)) {
  if (bundlePkg.dependencies[key] === "*") {
    // Attempt to parse out of pnpm-lock if strictly required, but usually these wildcard modules are implicitly provided.
    // For safety, we keep them as '*' so `npm install` gracefully pulls the latest compatible or skips.
  }
}

writeFileSync(join(bundleDir, "package.json"), JSON.stringify(bundlePkg, null, 2));

console.log("[build-bundle] === Finished Single-File Backend Bundling ===");
