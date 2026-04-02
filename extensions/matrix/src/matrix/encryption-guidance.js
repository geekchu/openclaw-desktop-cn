import { normalizeOptionalAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveDefaultMatrixAccountId } from "./accounts.js";
import { resolveMatrixConfigFieldPath } from "./config-update.js";
export function resolveMatrixEncryptionConfigPath(cfg, accountId) {
    const effectiveAccountId = normalizeOptionalAccountId(accountId) ?? resolveDefaultMatrixAccountId(cfg);
    return resolveMatrixConfigFieldPath(cfg, effectiveAccountId, "encryption");
}
export function formatMatrixEncryptionUnavailableError(cfg, accountId) {
    return `Matrix encryption is not available (enable ${resolveMatrixEncryptionConfigPath(cfg, accountId)}=true)`;
}
export function formatMatrixEncryptedEventDisabledWarning(cfg, accountId) {
    return `matrix: encrypted event received without encryption enabled; set ${resolveMatrixEncryptionConfigPath(cfg, accountId)}=true and verify the device to decrypt`;
}
