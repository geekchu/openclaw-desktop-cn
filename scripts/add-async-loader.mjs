import fs from "node:fs";

const code = fs.readFileSync("src/plugins/loader.ts", "utf8");

// Match everything from `export function loadOpenClawPlugins(` up to the matching closing brace.
// We can find the start and then count braces.
const startIdx = code.indexOf("export function loadOpenClawPlugins(");
if (startIdx === -1) throw new Error("Could not find loadOpenClawPlugins");

let openBraces = 0;
let endIdx = -1;
let started = false;

for (let i = startIdx; i < code.length; i++) {
  if (code[i] === "{") {
    openBraces++;
    started = true;
  } else if (code[i] === "}") {
    openBraces--;
  }

  if (started && openBraces === 0) {
    endIdx = i + 1;
    break;
  }
}

let asyncFunc = code.substring(startIdx, endIdx);

// Transformations:
// 1. Rename
asyncFunc = asyncFunc.replace(
  "export function loadOpenClawPlugins(",
  "export async function loadOpenClawPluginsAsync(",
);
// 2. Return Type
asyncFunc = asyncFunc.replace("): PluginRegistry {", "): Promise<PluginRegistry> {");
// 3. JITI -> import
asyncFunc = asyncFunc.replace(
  "mod = jiti(candidate.source) as OpenClawPluginModule;",
  "mod = (await import(candidate.source)) as OpenClawPluginModule;",
);
// 4. register(api) -> await register(api) if not already awaited.  Actually register is not awaited currently, we can just leave it or await it.
// The original code says `const result = register(api); if (result && typeof result.then === "function") { ... warn async ... }`
// Since this is true async now, we can await it:
asyncFunc = asyncFunc.replace(
  "const result = register(api);",
  "const result = await register(api);",
);
asyncFunc = asyncFunc.replace(
  /if \(result && typeof result\.then === "function"\) \{[\s\S]*?\}\s*/,
  "",
);

// Append to file
const newCode = code + "\n\n" + asyncFunc + "\n";
fs.writeFileSync("src/plugins/loader.ts", newCode);
console.log("Successfully duplicated loadOpenClawPlugins to loadOpenClawPluginsAsync");
