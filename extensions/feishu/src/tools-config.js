/**
 * Default tool configuration.
 * - doc, chat, wiki, drive, scopes: enabled by default
 * - perm: disabled by default (sensitive operation)
 */
export const DEFAULT_TOOLS_CONFIG = {
    doc: true,
    chat: true,
    wiki: true,
    drive: true,
    perm: false,
    scopes: true,
};
/**
 * Resolve tools config with defaults.
 */
export function resolveToolsConfig(cfg) {
    return { ...DEFAULT_TOOLS_CONFIG, ...cfg };
}
