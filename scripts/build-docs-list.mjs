#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const docsRoot = "docs";
const docExts = new Set([".md", ".mdx"]);
const excludedDirs = new Set([".i18n", "assets", "images"]);

function ensureDocsRootExists() {
  if (existsSync(docsRoot)) {
    return;
  }
  console.error(`docs:list failed: missing docs directory at ${docsRoot}`);
  process.exit(1);
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) {
        continue;
      }
      files.push(...walk(fullPath));
      continue;
    }

    if (docExts.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRoute(filePath) {
  const rel = relative(docsRoot, filePath).split(sep).join("/");
  const withoutExt = rel.replace(/\.(md|mdx)$/u, "");
  if (withoutExt === "index") {
    return "/";
  }
  if (withoutExt.endsWith("/index")) {
    return `/${withoutExt.slice(0, -"/index".length)}`;
  }
  return `/${withoutExt}`;
}

ensureDocsRootExists();

const routes = walk(docsRoot)
  .filter((filePath) => statSync(filePath).isFile())
  .map(toRoute)
  .sort((a, b) => a.localeCompare(b));

for (const route of routes) {
  console.log(route);
}
