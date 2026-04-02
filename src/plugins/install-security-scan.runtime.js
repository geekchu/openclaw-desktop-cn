import path from "node:path";
import { extensionUsesSkippedScannerPath, isPathInside } from "../security/scan-paths.js";
import { scanDirectoryWithSummary } from "../security/skill-scanner.js";
function buildCriticalDetails(params) {
    return params.findings
        .filter((finding) => finding.severity === "critical")
        .map((finding) => `${finding.message} (${finding.file}:${finding.line})`)
        .join("; ");
}
export async function scanBundleInstallSourceRuntime(params) {
    try {
        const scanSummary = await scanDirectoryWithSummary(params.sourceDir);
        if (scanSummary.critical > 0) {
            params.logger.warn?.(`WARNING: Bundle "${params.pluginId}" contains dangerous code patterns: ${buildCriticalDetails({ findings: scanSummary.findings })}`);
            return;
        }
        if (scanSummary.warn > 0) {
            params.logger.warn?.(`Bundle "${params.pluginId}" has ${scanSummary.warn} suspicious code pattern(s). Run "openclaw security audit --deep" for details.`);
        }
    }
    catch (err) {
        params.logger.warn?.(`Bundle "${params.pluginId}" code safety scan failed (${String(err)}). Installation continues; run "openclaw security audit --deep" after install.`);
    }
}
export async function scanPackageInstallSourceRuntime(params) {
    const forcedScanEntries = [];
    for (const entry of params.extensions) {
        const resolvedEntry = path.resolve(params.packageDir, entry);
        if (!isPathInside(params.packageDir, resolvedEntry)) {
            params.logger.warn?.(`extension entry escapes plugin directory and will not be scanned: ${entry}`);
            continue;
        }
        if (extensionUsesSkippedScannerPath(entry)) {
            params.logger.warn?.(`extension entry is in a hidden/node_modules path and will receive targeted scan coverage: ${entry}`);
        }
        forcedScanEntries.push(resolvedEntry);
    }
    try {
        const scanSummary = await scanDirectoryWithSummary(params.packageDir, {
            includeFiles: forcedScanEntries,
        });
        if (scanSummary.critical > 0) {
            params.logger.warn?.(`WARNING: Plugin "${params.pluginId}" contains dangerous code patterns: ${buildCriticalDetails({ findings: scanSummary.findings })}`);
            return;
        }
        if (scanSummary.warn > 0) {
            params.logger.warn?.(`Plugin "${params.pluginId}" has ${scanSummary.warn} suspicious code pattern(s). Run "openclaw security audit --deep" for details.`);
        }
    }
    catch (err) {
        params.logger.warn?.(`Plugin "${params.pluginId}" code safety scan failed (${String(err)}). Installation continues; run "openclaw security audit --deep" after install.`);
    }
}
