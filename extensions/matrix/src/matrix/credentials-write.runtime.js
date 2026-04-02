export async function saveMatrixCredentials(...args) {
    const runtime = await import("./credentials.js");
    return runtime.saveMatrixCredentials(...args);
}
export async function touchMatrixCredentials(...args) {
    const runtime = await import("./credentials.js");
    return runtime.touchMatrixCredentials(...args);
}
