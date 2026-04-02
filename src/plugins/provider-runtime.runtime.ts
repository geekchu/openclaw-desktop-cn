type ProviderRuntimeModule = typeof import("./provider-runtime.js");
import {
  augmentModelCatalogWithProviderPlugins as augmentModelCatalogWithProviderPluginsRuntime,
  buildProviderAuthDoctorHintWithPlugin as buildProviderAuthDoctorHintWithPluginRuntime,
  buildProviderMissingAuthMessageWithPlugin as buildProviderMissingAuthMessageWithPluginRuntime,
  formatProviderAuthProfileApiKeyWithPlugin as formatProviderAuthProfileApiKeyWithPluginRuntime,
  prepareProviderRuntimeAuth as prepareProviderRuntimeAuthRuntime,
  refreshProviderOAuthCredentialWithPlugin as refreshProviderOAuthCredentialWithPluginRuntime,
} from "./provider-runtime.js";

type AugmentModelCatalogWithProviderPlugins =
  ProviderRuntimeModule["augmentModelCatalogWithProviderPlugins"];
type BuildProviderAuthDoctorHintWithPlugin =
  ProviderRuntimeModule["buildProviderAuthDoctorHintWithPlugin"];
type BuildProviderMissingAuthMessageWithPlugin =
  ProviderRuntimeModule["buildProviderMissingAuthMessageWithPlugin"];
type FormatProviderAuthProfileApiKeyWithPlugin =
  ProviderRuntimeModule["formatProviderAuthProfileApiKeyWithPlugin"];
type PrepareProviderRuntimeAuth = ProviderRuntimeModule["prepareProviderRuntimeAuth"];
type RefreshProviderOAuthCredentialWithPlugin =
  ProviderRuntimeModule["refreshProviderOAuthCredentialWithPlugin"];

export async function augmentModelCatalogWithProviderPlugins(
  ...args: Parameters<AugmentModelCatalogWithProviderPlugins>
): Promise<Awaited<ReturnType<AugmentModelCatalogWithProviderPlugins>>> {
  return augmentModelCatalogWithProviderPluginsRuntime(...args);
}

export async function buildProviderAuthDoctorHintWithPlugin(
  ...args: Parameters<BuildProviderAuthDoctorHintWithPlugin>
): Promise<Awaited<ReturnType<BuildProviderAuthDoctorHintWithPlugin>>> {
  return buildProviderAuthDoctorHintWithPluginRuntime(...args);
}

export async function buildProviderMissingAuthMessageWithPlugin(
  ...args: Parameters<BuildProviderMissingAuthMessageWithPlugin>
): Promise<Awaited<ReturnType<BuildProviderMissingAuthMessageWithPlugin>>> {
  return buildProviderMissingAuthMessageWithPluginRuntime(...args);
}

export async function formatProviderAuthProfileApiKeyWithPlugin(
  ...args: Parameters<FormatProviderAuthProfileApiKeyWithPlugin>
): Promise<Awaited<ReturnType<FormatProviderAuthProfileApiKeyWithPlugin>>> {
  return formatProviderAuthProfileApiKeyWithPluginRuntime(...args);
}

export async function prepareProviderRuntimeAuth(
  ...args: Parameters<PrepareProviderRuntimeAuth>
): Promise<Awaited<ReturnType<PrepareProviderRuntimeAuth>>> {
  return prepareProviderRuntimeAuthRuntime(...args);
}

export async function refreshProviderOAuthCredentialWithPlugin(
  ...args: Parameters<RefreshProviderOAuthCredentialWithPlugin>
): Promise<Awaited<ReturnType<RefreshProviderOAuthCredentialWithPlugin>>> {
  return refreshProviderOAuthCredentialWithPluginRuntime(...args);
}
