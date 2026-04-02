import { resolveWhatsAppHeartbeatRecipients } from "../../channels/plugins/whatsapp-heartbeat.js";
import { getDefaultLocalRoots as getDefaultLocalRootsImpl, loadWebMedia as loadWebMediaImpl, loadWebMediaRaw as loadWebMediaRawImpl, optimizeImageToJpeg as optimizeImageToJpegImpl, } from "../../media/web-media.js";
import { loadPluginBoundaryModuleWithJiti, resolvePluginRuntimeModulePath, resolvePluginRuntimeRecord, } from "./runtime-plugin-boundary.js";
const WHATSAPP_PLUGIN_ID = "whatsapp";
let cachedHeavyModulePath = null;
let cachedHeavyModule = null;
let cachedLightModulePath = null;
let cachedLightModule = null;
const jitiLoaders = new Map();
function resolveWhatsAppPluginRecord() {
    return resolvePluginRuntimeRecord(WHATSAPP_PLUGIN_ID, () => {
        throw new Error(`WhatsApp plugin runtime is unavailable: missing plugin '${WHATSAPP_PLUGIN_ID}'`);
    });
}
function resolveWhatsAppRuntimeModulePath(record, entryBaseName) {
    const modulePath = resolvePluginRuntimeModulePath(record, entryBaseName, () => {
        throw new Error(`WhatsApp plugin runtime is unavailable: missing ${entryBaseName} for plugin '${WHATSAPP_PLUGIN_ID}'`);
    });
    if (!modulePath) {
        throw new Error(`WhatsApp plugin runtime is unavailable: missing ${entryBaseName} for plugin '${WHATSAPP_PLUGIN_ID}'`);
    }
    return modulePath;
}
function loadCurrentHeavyModuleSync() {
    const modulePath = resolveWhatsAppRuntimeModulePath(resolveWhatsAppPluginRecord(), "runtime-api");
    return loadPluginBoundaryModuleWithJiti(modulePath, jitiLoaders);
}
function loadWhatsAppLightModule() {
    const modulePath = resolveWhatsAppRuntimeModulePath(resolveWhatsAppPluginRecord(), "light-runtime-api");
    if (cachedLightModule && cachedLightModulePath === modulePath) {
        return cachedLightModule;
    }
    const loaded = loadPluginBoundaryModuleWithJiti(modulePath, jitiLoaders);
    cachedLightModulePath = modulePath;
    cachedLightModule = loaded;
    return loaded;
}
async function loadWhatsAppHeavyModule() {
    const record = resolveWhatsAppPluginRecord();
    const modulePath = resolveWhatsAppRuntimeModulePath(record, "runtime-api");
    if (cachedHeavyModule && cachedHeavyModulePath === modulePath) {
        return cachedHeavyModule;
    }
    const loaded = loadPluginBoundaryModuleWithJiti(modulePath, jitiLoaders);
    cachedHeavyModulePath = modulePath;
    cachedHeavyModule = loaded;
    return loaded;
}
function getLightExport(exportName) {
    const loaded = loadWhatsAppLightModule();
    const value = loaded[exportName];
    if (value == null) {
        throw new Error(`WhatsApp plugin runtime is missing export '${String(exportName)}'`);
    }
    return value;
}
async function getHeavyExport(exportName) {
    const loaded = await loadWhatsAppHeavyModule();
    const value = loaded[exportName];
    if (value == null) {
        throw new Error(`WhatsApp plugin runtime is missing export '${String(exportName)}'`);
    }
    return value;
}
export function getActiveWebListener(...args) {
    return getLightExport("getActiveWebListener")(...args);
}
export function getWebAuthAgeMs(...args) {
    return getLightExport("getWebAuthAgeMs")(...args);
}
export function logWebSelfId(...args) {
    return getLightExport("logWebSelfId")(...args);
}
export function loginWeb(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.loginWeb(...args));
}
export function logoutWeb(...args) {
    return getLightExport("logoutWeb")(...args);
}
export function readWebSelfId(...args) {
    return getLightExport("readWebSelfId")(...args);
}
export function webAuthExists(...args) {
    return getLightExport("webAuthExists")(...args);
}
export function sendMessageWhatsApp(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.sendMessageWhatsApp(...args));
}
export function sendPollWhatsApp(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.sendPollWhatsApp(...args));
}
export function sendReactionWhatsApp(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.sendReactionWhatsApp(...args));
}
export function createRuntimeWhatsAppLoginTool(...args) {
    return getLightExport("createWhatsAppLoginTool")(...args);
}
export function createWaSocket(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.createWaSocket(...args));
}
export function formatError(...args) {
    return getLightExport("formatError")(...args);
}
export function getStatusCode(...args) {
    return getLightExport("getStatusCode")(...args);
}
export function pickWebChannel(...args) {
    return getLightExport("pickWebChannel")(...args);
}
export function resolveWaWebAuthDir() {
    return getLightExport("WA_WEB_AUTH_DIR");
}
export async function handleWhatsAppAction(...args) {
    return (await getHeavyExport("handleWhatsAppAction"))(...args);
}
export async function loadWebMedia(...args) {
    return await loadWebMediaImpl(...args);
}
export async function loadWebMediaRaw(...args) {
    return await loadWebMediaRawImpl(...args);
}
export function monitorWebChannel(...args) {
    return loadWhatsAppHeavyModule().then((loaded) => loaded.monitorWebChannel(...args));
}
export async function monitorWebInbox(...args) {
    return (await getHeavyExport("monitorWebInbox"))(...args);
}
export async function optimizeImageToJpeg(...args) {
    return await optimizeImageToJpegImpl(...args);
}
export async function runWebHeartbeatOnce(...args) {
    return (await getHeavyExport("runWebHeartbeatOnce"))(...args);
}
export async function startWebLoginWithQr(...args) {
    return (await getHeavyExport("startWebLoginWithQr"))(...args);
}
export async function waitForWaConnection(...args) {
    return (await getHeavyExport("waitForWaConnection"))(...args);
}
export async function waitForWebLogin(...args) {
    return (await getHeavyExport("waitForWebLogin"))(...args);
}
export const extractMediaPlaceholder = (...args) => loadCurrentHeavyModuleSync().extractMediaPlaceholder(...args);
export const extractText = (...args) => loadCurrentHeavyModuleSync().extractText(...args);
export function getDefaultLocalRoots(...args) {
    return getDefaultLocalRootsImpl(...args);
}
export function resolveHeartbeatRecipients(...args) {
    return resolveWhatsAppHeartbeatRecipients(...args);
}
