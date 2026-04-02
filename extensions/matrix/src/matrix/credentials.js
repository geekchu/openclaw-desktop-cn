import { writeJsonFileAtomically } from "../runtime-api.js";
import { loadMatrixCredentials, resolveMatrixCredentialsPath } from "./credentials-read.js";
export { clearMatrixCredentials, credentialsMatchConfig, loadMatrixCredentials, resolveMatrixCredentialsDir, resolveMatrixCredentialsPath, } from "./credentials-read.js";
export async function saveMatrixCredentials(credentials, env = process.env, accountId) {
    const credPath = resolveMatrixCredentialsPath(env, accountId);
    const existing = loadMatrixCredentials(env, accountId);
    const now = new Date().toISOString();
    const toSave = {
        ...credentials,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
    };
    await writeJsonFileAtomically(credPath, toSave);
}
export async function touchMatrixCredentials(env = process.env, accountId) {
    const existing = loadMatrixCredentials(env, accountId);
    if (!existing) {
        return;
    }
    existing.lastUsedAt = new Date().toISOString();
    const credPath = resolveMatrixCredentialsPath(env, accountId);
    await writeJsonFileAtomically(credPath, existing);
}
