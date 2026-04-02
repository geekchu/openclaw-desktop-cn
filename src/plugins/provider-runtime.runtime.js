import { augmentModelCatalogWithProviderPlugins as augmentModelCatalogWithProviderPluginsRuntime, buildProviderAuthDoctorHintWithPlugin as buildProviderAuthDoctorHintWithPluginRuntime, buildProviderMissingAuthMessageWithPlugin as buildProviderMissingAuthMessageWithPluginRuntime, formatProviderAuthProfileApiKeyWithPlugin as formatProviderAuthProfileApiKeyWithPluginRuntime, prepareProviderRuntimeAuth as prepareProviderRuntimeAuthRuntime, refreshProviderOAuthCredentialWithPlugin as refreshProviderOAuthCredentialWithPluginRuntime, } from "./provider-runtime.js";
export async function augmentModelCatalogWithProviderPlugins(...args) {
    return augmentModelCatalogWithProviderPluginsRuntime(...args);
}
export async function buildProviderAuthDoctorHintWithPlugin(...args) {
    return buildProviderAuthDoctorHintWithPluginRuntime(...args);
}
export async function buildProviderMissingAuthMessageWithPlugin(...args) {
    return buildProviderMissingAuthMessageWithPluginRuntime(...args);
}
export async function formatProviderAuthProfileApiKeyWithPlugin(...args) {
    return formatProviderAuthProfileApiKeyWithPluginRuntime(...args);
}
export async function prepareProviderRuntimeAuth(...args) {
    return prepareProviderRuntimeAuthRuntime(...args);
}
export async function refreshProviderOAuthCredentialWithPlugin(...args) {
    return refreshProviderOAuthCredentialWithPluginRuntime(...args);
}
