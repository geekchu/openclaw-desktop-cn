import { formatTerminalLink } from "./terminal-link.js";
export function resolveDocsRoot() {
    return "https://docs.openclaw.ai";
}
export const DOCS_ROOT = resolveDocsRoot();
export function formatDocsLink(path, label, opts) {
    const trimmed = path.trim();
    const docsRoot = resolveDocsRoot();
    const url = trimmed.startsWith("http")
        ? trimmed
        : `${docsRoot}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
    return formatTerminalLink(label ?? url, url, {
        fallback: opts?.fallback ?? url,
        force: opts?.force,
    });
}
export function formatDocsRootLink(label) {
    const docsRoot = resolveDocsRoot();
    return formatTerminalLink(label ?? docsRoot, docsRoot, {
        fallback: docsRoot,
    });
}
