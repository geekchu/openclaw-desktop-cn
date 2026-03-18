#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const docsRoot = "docs";
const docExts = new Set([".md", ".mdx"]);
const assetExts = new Set([
  ".avif",
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".mjs",
  ".pdf",
  ".png",
  ".svg",
  ".txt",
  ".webp",
]);

function ensureDocsRootExists() {
  if (existsSync(docsRoot)) {
    return;
  }
  console.error(`docs:check-links failed: missing docs directory at ${docsRoot}`);
  process.exit(1);
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function toRoute(filePath) {
  const rel = relative(docsRoot, filePath).split(sep).join("/");
  const withoutExt = rel.replace(/\.(md|mdx)$/u, "");
  return withoutExt === "index" ? "/" : `/${withoutExt}`;
}

function normalizeDocPath(rawPath) {
  if (!rawPath.startsWith("/")) {
    return null;
  }
  const base = rawPath.split("#", 1)[0].split("?", 1)[0] || "/";
  return base !== "/" && base.endsWith("/") ? base.slice(0, -1) : base;
}

function addRouteAliases(routeSet, rawRoute) {
  const route = normalizeDocPath(rawRoute);
  if (!route) {
    return;
  }
  routeSet.add(route);

  if (route === "/") {
    routeSet.add("/index");
    return;
  }

  if (route.endsWith("/index")) {
    routeSet.add(route.slice(0, -"/index".length) || "/");
    return;
  }

  routeSet.add(`${route}/index`);
}

function readFrontmatterPermalink(filePath) {
  const contents = readFileSync(filePath, "utf8");
  const match = contents.match(/^---\n([\s\S]*?)\n---/u);
  if (!match) {
    return null;
  }
  const permalinkLine = match[1].match(/(?:^|\n)permalink:\s*(.+)\s*$/u);
  if (!permalinkLine) {
    return null;
  }
  return permalinkLine[1].replace(/^["']|["']$/gu, "").trim();
}

ensureDocsRootExists();

const allFiles = walk(docsRoot);
const docFiles = allFiles.filter((filePath) => docExts.has(extname(filePath)));
const staticFiles = new Set(
  allFiles
    .filter((filePath) => !docExts.has(extname(filePath)))
    .map((filePath) => `/${relative(docsRoot, filePath).split(sep).join("/")}`),
);
const routes = new Set();
for (const filePath of docFiles) {
  addRouteAliases(routes, toRoute(filePath));
  const permalink = readFrontmatterPermalink(filePath);
  if (permalink) {
    addRouteAliases(routes, permalink);
  }
}

const docsConfig = JSON.parse(readFileSync(join(docsRoot, "docs.json"), "utf8"));
const redirectSources = new Set((docsConfig.redirects ?? []).map((entry) => entry.source));
const redirectDestinations = new Set((docsConfig.redirects ?? []).map((entry) => entry.destination));

const navRefs = [];
function collectPageRefs(pages) {
  if (!Array.isArray(pages)) {
    return;
  }
  for (const item of pages) {
    if (typeof item === "string") {
      navRefs.push(item);
      continue;
    }
    if (item && typeof item === "object" && "pages" in item) {
      collectPageRefs(item.pages);
    }
  }
}

const languageEntries = docsConfig.navigation?.languages ?? [];
for (const language of languageEntries) {
  for (const tab of language.tabs ?? []) {
    for (const group of tab.groups ?? []) {
      collectPageRefs(group.pages);
    }
  }
}

const problems = [];

for (const page of navRefs) {
  if (page.includes("://")) {
    continue;
  }
  const route = page.startsWith("/") ? page : `/${page}`;
  if (!routes.has(route) && !redirectSources.has(route) && !redirectDestinations.has(route)) {
    problems.push(`docs/docs.json -> missing page route ${route}`);
  }
}

const linkPatterns = [
  /\[[^\]]+\]\((\/[^)\s]+)\)/gu,
  /\b(?:href|src)=["'](\/[^"']+)["']/gu,
];

for (const filePath of docFiles) {
  const contents = readFileSync(filePath, "utf8");
  const seen = new Set();

  for (const pattern of linkPatterns) {
    for (const match of contents.matchAll(pattern)) {
      const rawTarget = match[1];
      const target = normalizeDocPath(rawTarget);
      if (!target || seen.has(rawTarget)) {
        continue;
      }
      seen.add(rawTarget);

      const ext = extname(target);
      if (assetExts.has(ext)) {
        if (!staticFiles.has(target)) {
          problems.push(`${filePath} -> missing static asset ${rawTarget}`);
        }
        continue;
      }

      if (!routes.has(target) && !redirectSources.has(target) && !redirectDestinations.has(target)) {
        problems.push(`${filePath} -> missing docs route ${rawTarget}`);
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

console.log(`Docs link audit passed (${docFiles.length} docs files checked).`);
