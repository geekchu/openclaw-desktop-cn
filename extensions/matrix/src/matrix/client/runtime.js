export function isBunRuntime() {
    const versions = process.versions;
    return typeof versions.bun === "string";
}
