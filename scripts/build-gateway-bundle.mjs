import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const bundleDir = join(projectRoot, "src-tauri", "gateway-bundle");
const artifactsDir = join(projectRoot, ".artifacts");
const requireFromProjectRoot = createRequire(join(projectRoot, "package.json"));

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
    // Prioritize compiled dist/ output over source files to ensure proper module resolution
    const entryCandidates = ["dist/index.js", "index.ts", "index.js", "src/index.ts", "src/index.js"];
    const entry = entryCandidates.find((c) => existsSync(join(extPath, c)));

    if (entry) {
      extensions.push({ name: ext, entry: `../extensions/${ext}/${entry}` });
    }
  }
}

console.log(`[build-bundle] Found ${extensions.length} extensions to bundle statically.`);

// 2. Generate synthetic entry file
const syntheticEntryPath = join(artifactsDir, "gateway-bundle-entry.js");

// globalThis.__BUNDLED_EXTENSIONS__ is initialized in the esbuild banner (runs first)
// Here we just get a reference to it and populate it with extension modules
let syntheticContent = `// Auto-generated entry point for single-file esbuild bundling
import '${join(projectRoot, "dist/warning-filter.js").replace(/\\/g, "/")}';

// Get reference to the object initialized in banner
const __BUNDLED_EXTENSIONS__ = globalThis.__BUNDLED_EXTENSIONS__;
`;

for (let i = 0; i < extensions.length; i++) {
  const ext = extensions[i];
  // resolve absolute path for extension entry
  const absEntry = resolve(artifactsDir, ext.entry).replace(/\\/g, "/");
  syntheticContent += `import * as ext_${i} from '${absEntry}';\n`;
  syntheticContent += `__BUNDLED_EXTENSIONS__['${ext.name}'] = ext_${i};\n`;
}

// Finally import the main app entry (globalThis.__BUNDLED_EXTENSIONS__ is already set above)
syntheticContent += `import '${join(projectRoot, "dist/entry.js").replace(/\\/g, "/")}';\n`;

writeFileSync(syntheticEntryPath, syntheticContent, "utf-8");

// 3. Clear target bundle dir but keep the skeleton
if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
mkdirSync(bundleDir, { recursive: true });

// 4. Run esbuild
console.log("[build-bundle] Running esbuild...");

try {
  const buildResult = esbuild.buildSync({
    entryPoints: [syntheticEntryPath],
    bundle: true,
    outfile: join(bundleDir, "openclaw.mjs"),
    metafile: true,
    format: "esm",
    platform: "node",
    target: "node22",
    // Disable tree-shaking to ensure __BUNDLED_EXTENSIONS__ assignment is preserved
    treeShaking: false,
    banner: {
      // Polyfill `require`, `__filename`, and `__dirname` in ESM format so CJS modules don't crash
      // CRITICAL: Also initialize globalThis.__BUNDLED_EXTENSIONS__ HERE in the banner
      // so it exists BEFORE any module code runs (including init_entry())
      js: "import * as __esm_banner_module from 'module'; import * as __esm_banner_url from 'url'; import * as __esm_banner_path from 'path'; const require = __esm_banner_module.createRequire(import.meta.url); const __filename = __esm_banner_url.fileURLToPath(import.meta.url); const __dirname = __esm_banner_path.dirname(__filename); globalThis.__BUNDLED_EXTENSIONS__ = {};",
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

  const rootPkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
  const declaredDeps = new Map();
  for (const [name, version] of Object.entries(rootPkg.dependencies || {})) {
    if (typeof version === "string" && !version.startsWith("workspace:")) {
      declaredDeps.set(name, version);
    }
  }
  for (const ext of extensions) {
    const extPkgPath = join(projectRoot, "extensions", ext.name, "package.json");
    if (!existsSync(extPkgPath)) {
      continue;
    }
    const extPkg = JSON.parse(readFileSync(extPkgPath, "utf-8"));
    for (const [name, version] of Object.entries(extPkg.dependencies || {})) {
      if (
        typeof version === "string" &&
        !version.startsWith("workspace:") &&
        !declaredDeps.has(name)
      ) {
        declaredDeps.set(name, version);
      }
    }
  }

  const builtinSet = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]));
  const requiredDeps = new Map();
  const resolvedVersions = new Map();
  const bundleText = readFileSync(join(bundleDir, "openclaw.mjs"), "utf-8");

  function topLevelPackage(specifier) {
    if (
      !specifier ||
      specifier === "<runtime>" ||
      specifier.startsWith(".") ||
      specifier.startsWith("/") ||
      specifier.startsWith("node:") ||
      /^[A-Za-z]:/.test(specifier)
    ) {
      return null;
    }
    if (specifier.startsWith("@")) {
      const parts = specifier.split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
    }
    return specifier.split("/")[0];
  }

  function includePackage(specifier) {
    const pkgName = topLevelPackage(specifier);
    if (!pkgName || builtinSet.has(pkgName)) {
      return;
    }
    let version = declaredDeps.get(pkgName);
    if (!version) {
      if (resolvedVersions.has(pkgName)) {
        version = resolvedVersions.get(pkgName);
      } else {
        try {
          const installedPkgPath = requireFromProjectRoot.resolve(`${pkgName}/package.json`);
          const installedPkg = JSON.parse(readFileSync(installedPkgPath, "utf-8"));
          version =
            typeof installedPkg.version === "string" ? installedPkg.version.trim() : undefined;
        } catch {
          version = undefined;
        }
        resolvedVersions.set(pkgName, version);
      }
    }
    if (version) {
      requiredDeps.set(pkgName, version);
    }
  }

  for (const input of Object.values(buildResult.metafile?.inputs || {})) {
    for (const imp of input.imports || []) {
      if (imp.external) {
        includePackage(imp.path);
      }
    }
  }

  const runtimeRequirePattern = /(?:^|[^\w$.])(?:__require|require)\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (const match of bundleText.matchAll(runtimeRequirePattern)) {
    includePackage(match[1]);
  }

  for (const pkgName of ["playwright-core", "ffmpeg-static", "@tloncorp/tlon-skill", "@vector-im/matrix-bot-sdk"]) {
    includePackage(pkgName);
  }

  const bundlePkg = {
    name: rootPkg.name,
    version: rootPkg.version,
    type: "module",
    main: "openclaw.mjs",
    dependencies: Object.fromEntries(
      [...requiredDeps.entries()].toSorted(([a], [b]) => a.localeCompare(b)),
    ),
    optionalDependencies: {},
  };

  writeFileSync(join(bundleDir, "package.json"), JSON.stringify(bundlePkg, null, 2));
  console.log(
    `[build-bundle] Created optimized package.json (${requiredDeps.size} runtime dependencies retained).`,
  );

  const bundledExtensionsDir = join(bundleDir, "extensions");
  mkdirSync(bundledExtensionsDir, { recursive: true });

  for (const ext of extensions) {
    const sourceRoot = join(projectRoot, "extensions", ext.name);
    const targetRoot = join(bundledExtensionsDir, ext.name);
    mkdirSync(targetRoot, { recursive: true });

    const manifestPath = join(sourceRoot, "openclaw.plugin.json");
    if (existsSync(manifestPath)) {
      copyFileSync(manifestPath, join(targetRoot, "openclaw.plugin.json"));
    }

    const packagePath = join(sourceRoot, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
      if (packageJson?.openclaw && Array.isArray(packageJson.openclaw.extensions)) {
        packageJson.openclaw = {
          ...packageJson.openclaw,
          extensions: ["./index.cjs"],
        };
      }
      if (typeof packageJson.main === "string") {
        packageJson.main = "./index.cjs";
      }
      writeFileSync(
        join(targetRoot, "package.json"),
        JSON.stringify(packageJson, null, 2),
        "utf-8",
      );
    }

    const shimSource = [
      `const extension = globalThis.__BUNDLED_EXTENSIONS__?.[${JSON.stringify(ext.name)}];`,
      "if (!extension) {",
      `  throw new Error(${JSON.stringify(`Bundled extension shim could not find ${ext.name} in __BUNDLED_EXTENSIONS__`)});`,
      "}",
      "module.exports = extension;",
      "",
    ].join("\n");
    writeFileSync(join(targetRoot, "index.cjs"), shimSource, "utf-8");

    // Copy skills directories declared in openclaw.plugin.json
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (Array.isArray(manifest.skills)) {
          for (const skillPath of manifest.skills) {
            if (typeof skillPath !== "string") {
              continue;
            }
            // Skills can be relative paths (e.g. "skills/qqbot-cron") or
            // node_modules paths (e.g. "node_modules/@tloncorp/tlon-skill")
            const srcSkillDir = join(sourceRoot, skillPath);
            const destSkillDir = join(targetRoot, skillPath);
            if (existsSync(srcSkillDir)) {
              mkdirSync(dirname(destSkillDir), { recursive: true });
              if (process.platform === "win32") {
                try {
                  execSync(
                    `robocopy "${srcSkillDir}" "${destSkillDir}" /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git`,
                    { windowsHide: true },
                  );
                } catch (err) {
                  if (err.status >= 8) {
                    throw err;
                  }
                }
              } else {
                execSync(`cp -R "${srcSkillDir}" "${destSkillDir}"`);
              }
              console.log(`[build-bundle] Copied skill: extensions/${ext.name}/${skillPath}`);
            } else {
              console.log(`[build-bundle] Warning: skill not found: ${srcSkillDir}`);
            }
          }
        }
      } catch {
        // manifest parse error, skip skills
      }
    }
  }
  console.log(`[build-bundle] Created ${extensions.length} bundled extension shims.`);
} catch (err) {
  console.error("[build-bundle] Esbuild failed:", err);
  process.exit(1);
}

// 5. Copy necessary runtime assets that aren't JS modules
console.log("[build-bundle] Copying runtime assets...");
// Ex: docs/reference/templates which is expected by the daemon/init
const copyTargets = ["dist/control-ui", "docs/reference/templates", "assets", "skills"];

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

console.log("[build-bundle] === Finished Single-File Backend Bundling ===");
