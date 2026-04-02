export function createPairingPrefixStripper(prefixRe, map = (entry) => entry) {
    return (entry) => map(entry.trim().replace(prefixRe, "").trim());
}
export function createLoggedPairingApprovalNotifier(format, log = console.log) {
    return async (params) => {
        log(typeof format === "function" ? format(params) : format);
    };
}
export function createTextPairingAdapter(params) {
    return {
        idLabel: params.idLabel,
        normalizeAllowEntry: params.normalizeAllowEntry,
        notifyApproval: async (ctx) => {
            await params.notify({ ...ctx, message: params.message });
        },
    };
}
