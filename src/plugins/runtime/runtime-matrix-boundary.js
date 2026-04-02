import { loadPluginBoundaryModuleWithJiti, resolvePluginRuntimeModulePath, resolvePluginRuntimeRecord, } from "./runtime-plugin-boundary.js";
const MATRIX_PLUGIN_ID = "matrix";
let cachedModulePath = null;
let cachedModule = null;
const jitiLoaders = new Map();
function resolveMatrixPluginRecord() {
    return resolvePluginRuntimeRecord(MATRIX_PLUGIN_ID);
}
function resolveMatrixRuntimeModulePath(record) {
    return resolvePluginRuntimeModulePath(record, "runtime-api");
}
function loadMatrixModule() {
    const record = resolveMatrixPluginRecord();
    if (!record) {
        return null;
    }
    const modulePath = resolveMatrixRuntimeModulePath(record);
    if (!modulePath) {
        return null;
    }
    if (cachedModule && cachedModulePath === modulePath) {
        return cachedModule;
    }
    const loaded = loadPluginBoundaryModuleWithJiti(modulePath, jitiLoaders);
    cachedModulePath = modulePath;
    cachedModule = loaded;
    return loaded;
}
export function setMatrixThreadBindingIdleTimeoutBySessionKey(...args) {
    const fn = loadMatrixModule()?.setMatrixThreadBindingIdleTimeoutBySessionKey;
    if (typeof fn !== "function") {
        return [];
    }
    return fn(...args);
}
export function setMatrixThreadBindingMaxAgeBySessionKey(...args) {
    const fn = loadMatrixModule()?.setMatrixThreadBindingMaxAgeBySessionKey;
    if (typeof fn !== "function") {
        return [];
    }
    return fn(...args);
}
