async function loadInstallSecurityScanRuntime() {
    return await import("./install-security-scan.runtime.js");
}
export async function scanBundleInstallSource(params) {
    const { scanBundleInstallSourceRuntime } = await loadInstallSecurityScanRuntime();
    await scanBundleInstallSourceRuntime(params);
}
export async function scanPackageInstallSource(params) {
    const { scanPackageInstallSourceRuntime } = await loadInstallSecurityScanRuntime();
    await scanPackageInstallSourceRuntime(params);
}
