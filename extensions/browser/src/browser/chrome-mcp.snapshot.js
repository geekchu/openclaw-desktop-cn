import { getRoleSnapshotStats, } from "./pw-role-snapshot.js";
import { CONTENT_ROLES, INTERACTIVE_ROLES, STRUCTURAL_ROLES } from "./snapshot-roles.js";
function normalizeRole(node) {
    const role = typeof node.role === "string" ? node.role.trim().toLowerCase() : "";
    return role || "generic";
}
function normalizeString(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || undefined;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return undefined;
}
function escapeQuoted(value) {
    return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
function shouldIncludeNode(params) {
    if (params.options?.interactive && !INTERACTIVE_ROLES.has(params.role)) {
        return false;
    }
    if (params.options?.compact && STRUCTURAL_ROLES.has(params.role) && !params.name) {
        return false;
    }
    return true;
}
function shouldCreateRef(role, name) {
    return INTERACTIVE_ROLES.has(role) || (CONTENT_ROLES.has(role) && Boolean(name));
}
function createDuplicateTracker() {
    return {
        counts: new Map(),
        keysByRef: new Map(),
        duplicates: new Set(),
    };
}
function registerRef(tracker, ref, role, name) {
    const key = `${role}:${name ?? ""}`;
    const count = tracker.counts.get(key) ?? 0;
    tracker.counts.set(key, count + 1);
    tracker.keysByRef.set(ref, key);
    if (count > 0) {
        tracker.duplicates.add(key);
        return count;
    }
    return undefined;
}
export function flattenChromeMcpSnapshotToAriaNodes(root, limit = 500) {
    const boundedLimit = Math.max(1, Math.min(2000, Math.floor(limit)));
    const out = [];
    const visit = (node, depth) => {
        if (out.length >= boundedLimit) {
            return;
        }
        const ref = normalizeString(node.id);
        if (ref) {
            out.push({
                ref,
                role: normalizeRole(node),
                name: normalizeString(node.name) ?? "",
                value: normalizeString(node.value),
                description: normalizeString(node.description),
                depth,
            });
        }
        for (const child of node.children ?? []) {
            visit(child, depth + 1);
            if (out.length >= boundedLimit) {
                return;
            }
        }
    };
    visit(root, 0);
    return out;
}
export function buildAiSnapshotFromChromeMcpSnapshot(params) {
    const refs = {};
    const tracker = createDuplicateTracker();
    const lines = [];
    const visit = (node, depth) => {
        const role = normalizeRole(node);
        const name = normalizeString(node.name);
        const value = normalizeString(node.value);
        const description = normalizeString(node.description);
        const maxDepth = params.options?.maxDepth;
        if (maxDepth !== undefined && depth > maxDepth) {
            return;
        }
        const includeNode = shouldIncludeNode({ role, name, options: params.options });
        if (includeNode) {
            let line = `${"  ".repeat(depth)}- ${role}`;
            if (name) {
                line += ` "${escapeQuoted(name)}"`;
            }
            const ref = normalizeString(node.id);
            if (ref && shouldCreateRef(role, name)) {
                const nth = registerRef(tracker, ref, role, name);
                refs[ref] = nth === undefined ? { role, name } : { role, name, nth };
                line += ` [ref=${ref}]`;
            }
            if (value) {
                line += ` value="${escapeQuoted(value)}"`;
            }
            if (description) {
                line += ` description="${escapeQuoted(description)}"`;
            }
            lines.push(line);
        }
        for (const child of node.children ?? []) {
            visit(child, depth + 1);
        }
    };
    visit(params.root, 0);
    for (const [ref, data] of Object.entries(refs)) {
        const key = tracker.keysByRef.get(ref);
        if (key && !tracker.duplicates.has(key)) {
            delete data.nth;
        }
    }
    let snapshot = lines.join("\n");
    let truncated = false;
    const maxChars = typeof params.maxChars === "number" && Number.isFinite(params.maxChars) && params.maxChars > 0
        ? Math.floor(params.maxChars)
        : undefined;
    if (maxChars && snapshot.length > maxChars) {
        snapshot = `${snapshot.slice(0, maxChars)}\n\n[...TRUNCATED - page too large]`;
        truncated = true;
    }
    const stats = getRoleSnapshotStats(snapshot, refs);
    return truncated ? { snapshot, truncated, refs, stats } : { snapshot, refs, stats };
}
