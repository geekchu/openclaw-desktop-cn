import { buildCommandTextFromArgs as buildCommandTextFromArgsImpl, findCommandByNativeName as findCommandByNativeNameImpl, listNativeCommandSpecsForConfig as listNativeCommandSpecsForConfigImpl, parseCommandArgs as parseCommandArgsImpl, resolveCommandArgMenu as resolveCommandArgMenuImpl, } from "openclaw/plugin-sdk/command-auth";
export function buildCommandTextFromArgs(...args) {
    return buildCommandTextFromArgsImpl(...args);
}
export function findCommandByNativeName(...args) {
    return findCommandByNativeNameImpl(...args);
}
export function listNativeCommandSpecsForConfig(...args) {
    return listNativeCommandSpecsForConfigImpl(...args);
}
export function parseCommandArgs(...args) {
    return parseCommandArgsImpl(...args);
}
export function resolveCommandArgMenu(...args) {
    return resolveCommandArgMenuImpl(...args);
}
