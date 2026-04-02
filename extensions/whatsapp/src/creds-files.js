import fsSync from "node:fs";
import path from "node:path";
export function resolveWebCredsPath(authDir) {
    return path.join(authDir, "creds.json");
}
export function resolveWebCredsBackupPath(authDir) {
    return path.join(authDir, "creds.json.bak");
}
export function hasWebCredsSync(authDir) {
    try {
        const stats = fsSync.statSync(resolveWebCredsPath(authDir));
        return stats.isFile() && stats.size > 1;
    }
    catch {
        return false;
    }
}
