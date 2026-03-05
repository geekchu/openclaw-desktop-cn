#!/usr/bin/env node
/**
 * fix-exportall.mjs
 *
 * Fixes circular dependency in rolldown 1.0.0-rc.4 output where __exportAll
 * helper is imported from a chunk with circular imports. Inlines the helper.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const INLINE_HELPER = `var __defProp$inline = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
\tlet target = {};
\tfor (var name in all) {
\t\t__defProp$inline(target, name, { get: all[name], enumerable: true });
\t}
\tif (!no_symbols) {
\t\t__defProp$inline(target, Symbol.toStringTag, { value: "Module" });
\t}
\treturn target;
};
`;

function fixFile(filePath) {
  let content = readFileSync(filePath, "utf-8");
  if (!content.includes("__exportAll")) return false;

  const lines = content.split("\n");
  let modified = false;
  const newLines = [];

  for (const line of lines) {
    if (
      line.includes("__exportAll") &&
      line.trimStart().startsWith("import ") &&
      line.includes(" from ")
    ) {
      const importMatch = line.match(/^(import\s*\{)(.*)\}\s*from\s*(".*");?\s*$/);
      if (!importMatch) {
        newLines.push(line);
        continue;
      }

      const [, , bindingsStr, moduleSpec] = importMatch;
      const bindings = bindingsStr
        .split(",")
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
      const remaining = bindings.filter((b) => !/ as __exportAll\b/.test(b) && b !== "__exportAll");

      if (remaining.length === bindings.length) {
        newLines.push(line);
        continue;
      }
      modified = true;

      if (remaining.length > 0) {
        newLines.push(`import { ${remaining.join(", ")} } from ${moduleSpec};`);
      }
    } else {
      newLines.push(line);
    }
  }

  if (!modified) return false;

  let lastImportIdx = -1;
  for (let i = 0; i < newLines.length; i++) {
    if (newLines[i].trimStart().startsWith("import ")) lastImportIdx = i;
  }
  newLines.splice(lastImportIdx + 1, 0, "", INLINE_HELPER);

  writeFileSync(filePath, newLines.join("\n"), "utf-8");
  return true;
}

function processDir(dir) {
  let fixed = 0;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".js")) continue;
      try {
        if (fixFile(join(dir, file))) {
          console.log(`  Fixed: ${file}`);
          fixed++;
        }
      } catch {}
    }
  } catch {}
  return fixed;
}

let total = 0;
total += processDir(join(process.cwd(), "dist"));
total += processDir(join(process.cwd(), "dist", "plugin-sdk"));
console.log(`Done. Fixed ${total} files.`);
