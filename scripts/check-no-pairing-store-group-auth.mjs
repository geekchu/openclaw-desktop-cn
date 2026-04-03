#!/usr/bin/env node

import path from "node:path";
import ts from "typescript";
import {
  collectFileViolations,
  getPropertyNameText,
  resolveRepoRoot,
  resolveSourceRoots,
  runAsScript,
  toLine,
  unwrapExpression,
} from "./lib/ts-guard-utils.mjs";

const sourceRoots = ["src", "extensions"];
const groupGuardCallees = new Set([
  "evaluateMatchedGroupAccessForPolicy",
  "evaluateSenderGroupAccessForPolicy",
]);
const forbiddenIdentifiers = new Set([
  "effectiveAllowFrom",
  "fromStore",
  "normalizedStoreAllowFrom",
  "storeAllowFrom",
  "storeAllowList",
  "storedAllowFrom",
]);
const forbiddenCallCallees = new Set([
  "mergeDmAllowFromSources",
  "readAllowFromStore",
  "readChannelAllowFromStore",
  "readChannelAllowFromStoreSync",
  "readStoreAllowFromForDmPolicy",
]);

function normalizeRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function getCalleeName(expression) {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) {
    return target.text;
  }
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text;
  }
  return null;
}

function expressionUsesForbiddenGroupSource(expression) {
  let matched = null;

  const visit = (node) => {
    if (matched) {
      return;
    }
    if (ts.isIdentifier(node) && forbiddenIdentifiers.has(node.text)) {
      matched = node.text;
      return;
    }
    if (ts.isCallExpression(node)) {
      const calleeName = getCalleeName(node.expression);
      if (calleeName && forbiddenCallCallees.has(calleeName)) {
        matched = calleeName;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(expression);
  return matched;
}

function getObjectPropertyInitializer(property) {
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }
  return null;
}

function getObjectPropertyName(property) {
  if (ts.isPropertyAssignment(property)) {
    return getPropertyNameText(property.name);
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name.text;
  }
  return null;
}

function collectDangerousGroupAllowFromAssignments(sourceFile, objectLiteral, violations, context) {
  for (const property of objectLiteral.properties) {
    const propertyName = getObjectPropertyName(property);
    if (propertyName !== "groupAllowFrom") {
      continue;
    }
    const initializer = getObjectPropertyInitializer(property);
    if (!initializer) {
      continue;
    }
    const matched = expressionUsesForbiddenGroupSource(initializer);
    if (!matched) {
      continue;
    }
    const matchedSource = String(matched);
    violations.push({
      line: toLine(sourceFile, property),
      reason: `${context} must not derive groupAllowFrom from DM pairing-store data (${matchedSource})`,
    });
  }
}

export function findPairingStoreGroupAuthViolations(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const violations = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const calleeName = getCalleeName(node.expression);
      const firstArg = node.arguments[0];

      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        collectDangerousGroupAllowFromAssignments(sourceFile, firstArg, violations, calleeName);

        if (calleeName && groupGuardCallees.has(calleeName)) {
          for (const property of firstArg.properties) {
            const propertyName = getObjectPropertyName(property);
            if (propertyName !== "groupAllowFrom" && propertyName !== "allowFrom") {
              continue;
            }
            const initializer = getObjectPropertyInitializer(property);
            if (!initializer) {
              continue;
            }
            const matched = expressionUsesForbiddenGroupSource(initializer);
            if (!matched) {
              continue;
            }
            const matchedSource = String(matched);
            violations.push({
              line: toLine(sourceFile, property),
              reason: `${calleeName} must not authorize groups from DM pairing-store data (${matchedSource})`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function shouldSkipFile(repoRoot, filePath) {
  const relativePath = normalizeRelativePath(repoRoot, filePath);
  return relativePath.endsWith(".d.ts");
}

export async function main() {
  const repoRoot = resolveRepoRoot(import.meta.url);
  const violations = await collectFileViolations({
    repoRoot,
    sourceRoots: resolveSourceRoots(repoRoot, sourceRoots),
    skipFile: (filePath) => shouldSkipFile(repoRoot, filePath),
    findViolations: findPairingStoreGroupAuthViolations,
  });

  if (violations.length === 0) {
    return;
  }

  console.error(
    "Found group authorization paths that inherit DM pairing-store approvals. Group auth must stay explicit and must not consume pairing-store data:",
  );
  for (const violation of violations.toSorted(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.reason.localeCompare(right.reason),
  )) {
    console.error(`- ${violation.path}:${violation.line} ${violation.reason}`);
  }
  process.exitCode = 1;
}

runAsScript(import.meta.url, main);
