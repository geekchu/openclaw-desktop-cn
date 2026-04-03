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
const lowLevelReadCallees = new Set(["readChannelAllowFromStore", "readChannelAllowFromStoreSync"]);
const lowLevelWriteCallees = new Set(["upsertChannelPairingRequest"]);

function normalizeRelativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function getPropertyAccessSegments(expression) {
  const target = unwrapExpression(expression);
  if (ts.isIdentifier(target)) {
    return [target.text];
  }
  if (!ts.isPropertyAccessExpression(target)) {
    return null;
  }

  const segments = [];
  let current = target;
  while (ts.isPropertyAccessExpression(current)) {
    segments.unshift(current.name.text);
    current = unwrapExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) {
    return null;
  }
  segments.unshift(current.text);
  return segments;
}

function endsWithSegments(segments, expectedSuffix) {
  if (!segments || segments.length < expectedSuffix.length) {
    return false;
  }
  return expectedSuffix.every(
    (segment, index) => segments[segments.length - expectedSuffix.length + index] === segment,
  );
}

function isExplicitAccountIdExpression(expression) {
  if (!expression) {
    return false;
  }
  if (ts.isIdentifier(expression) && expression.text === "undefined") {
    return false;
  }
  return true;
}

function getObjectPropertyExpression(objectLiteral, propertyName) {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property)) {
      if (getPropertyNameText(property.name) !== propertyName) {
        continue;
      }
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName) {
      return property.name;
    }
  }
  return null;
}

function hasExplicitObjectAccountId(argument) {
  return (
    ts.isObjectLiteralExpression(argument) &&
    isExplicitAccountIdExpression(getObjectPropertyExpression(argument, "accountId"))
  );
}

function describeCallsite(callee) {
  const segments = getPropertyAccessSegments(callee);
  return segments ? segments.join(".") : callee.getText();
}

export function findPairingAccountScopeViolations(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const violations = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const calleeSegments = getPropertyAccessSegments(callee);
      const calleeName = calleeSegments?.at(-1) ?? null;
      const callsite = describeCallsite(callee);

      if (calleeName && lowLevelReadCallees.has(calleeName)) {
        const accountIdArg = node.arguments[2];
        if (!isExplicitAccountIdExpression(accountIdArg)) {
          violations.push({
            line: toLine(sourceFile, node.expression),
            reason: `${callsite} must receive an explicit accountId argument`,
          });
        }
      }

      if (calleeName && lowLevelWriteCallees.has(calleeName)) {
        const requestArg = node.arguments[0];
        if (!requestArg || !hasExplicitObjectAccountId(requestArg)) {
          violations.push({
            line: toLine(sourceFile, node.expression),
            reason: `${callsite} must include accountId in its request payload`,
          });
        }
      }

      if (endsWithSegments(calleeSegments, ["channel", "pairing", "readAllowFromStore"])) {
        const requestArg = node.arguments[0];
        if (!requestArg || !hasExplicitObjectAccountId(requestArg)) {
          violations.push({
            line: toLine(sourceFile, node.expression),
            reason: `${callsite} must include accountId in its scoped request payload`,
          });
        }
      }

      if (endsWithSegments(calleeSegments, ["channel", "pairing", "upsertPairingRequest"])) {
        const requestArg = node.arguments[0];
        if (!requestArg || !hasExplicitObjectAccountId(requestArg)) {
          violations.push({
            line: toLine(sourceFile, node.expression),
            reason: `${callsite} must include accountId in its scoped request payload`,
          });
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
  return (
    relativePath.endsWith(".d.ts") ||
    relativePath === "src/pairing/pairing-store.ts" ||
    relativePath === "src/pairing/pairing-challenge.ts"
  );
}

export async function main() {
  const repoRoot = resolveRepoRoot(import.meta.url);
  const violations = await collectFileViolations({
    repoRoot,
    sourceRoots: resolveSourceRoots(repoRoot, sourceRoots),
    skipFile: (filePath) => shouldSkipFile(repoRoot, filePath),
    findViolations: findPairingAccountScopeViolations,
  });

  if (violations.length === 0) {
    return;
  }

  console.error(
    "Found pairing-store calls without explicit account scoping. Pairing-store reads/writes must stay account-scoped outside the shared pairing helpers:",
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
