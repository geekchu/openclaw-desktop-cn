// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type SuggestedModel = {
  id: string;
  name: string;
  description: string | null;
  context_window: number | null;
  max_tokens: number | null;
  recommended: boolean;
};

type OfficialProvider = {
  id: string;
  name: string;
  icon: string;
  default_base_url: string | null;
  api_type: string;
  suggested_models: SuggestedModel[];
  requires_api_key: boolean;
  docs_url: string | null;
};

type AIConfigOverview = {
  primary_model: string | null;
  configured_providers: Array<{
    name: string;
    base_url: string;
    api_type: string | null;
    api_key_masked: string | null;
    has_api_key: boolean;
    models: Array<{
      full_id: string;
      id: string;
      name: string;
      api_type: string | null;
      input: string[];
      context_window: number | null;
      max_tokens: number | null;
      reasoning: boolean | null;
      cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      } | null;
      is_primary: boolean;
    }>;
  }>;
  available_models: string[];
};

type CustomProvidersElement = HTMLElement & {
  aiConfig: AIConfigOverview | null;
  officialProviders: OfficialProvider[];
  loading: boolean;
  error: string | null;
  formProviderName: string;
  formBaseUrl: string;
  formApiKey: string;
  formApiType: string;
  formSelectedModels: string[];
  formSaving: boolean;
  formError: string | null;
  editingProvider: AIConfigOverview["configured_providers"][number] | null;
  loadData: () => Promise<void>;
  refreshConfig: () => Promise<boolean>;
  handleSwitchModel: (modelId: string) => Promise<void>;
  handleSaveProvider: () => Promise<void>;
  updateComplete: Promise<boolean>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();
let previousTauri:
  | {
      core?: {
        invoke?: typeof invokeMock;
      };
    }
  | undefined;

beforeAll(async () => {
  previousTauri = (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__;

  (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__ = {
    core: {
      invoke: invokeMock,
    },
  };

  await import("./config-custom-providers.ts");
});

afterAll(() => {
  (
    window as typeof window & {
      __TAURI__?: {
        core?: {
          invoke?: typeof invokeMock;
        };
      };
    }
  ).__TAURI__ = previousTauri;
});

afterEach(() => {
  invokeMock.mockReset();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function createElement(): CustomProvidersElement {
  const ctor = customElements.get("openclaw-custom-providers");
  if (!ctor) {
    throw new Error("openclaw-custom-providers is not registered");
  }
  return new ctor() as CustomProvidersElement;
}

function createAiConfig(primaryModel: string): AIConfigOverview {
  return {
    primary_model: primaryModel,
    configured_providers: [
      {
        name: "custom-provider",
        base_url: "https://example.com/v1",
        api_type: "openai-completions",
        api_key_masked: "sk-****",
        has_api_key: true,
        models: [],
      },
      {
        name: "onestop",
        base_url: "https://api.openclawcn.net/v1",
        api_type: "openai-completions",
        api_key_masked: "sk-****",
        has_api_key: true,
        models: [],
      },
    ],
    available_models: [primaryModel],
  };
}

function requireAiConfig(element: CustomProvidersElement): AIConfigOverview {
  expect(element.aiConfig).not.toBeNull();
  if (!element.aiConfig) {
    throw new Error("aiConfig should be loaded");
  }
  return element.aiConfig;
}

function requireSavePayload(payload: Record<string, unknown> | null): Record<string, unknown> {
  expect(payload).not.toBeNull();
  if (!payload) {
    throw new Error("save payload should be present");
  }
  return payload;
}

describe("config-custom-providers refresh ordering", () => {
  it("does not let an older loadData config response overwrite a newer refreshConfig result", async () => {
    const initialConfig = deferred<AIConfigOverview>();
    const refreshedConfig = deferred<AIConfigOverview>();

    invokeMock
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_official_providers");
        return [] satisfies OfficialProvider[];
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_ai_config");
        return initialConfig.promise;
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_ai_config");
        return refreshedConfig.promise;
      });

    const element = createElement();
    element.aiConfig = createAiConfig("custom-provider/seed");
    document.body.append(element);
    await element.updateComplete;
    element.aiConfig = null;

    const loadPromise = element.loadData();
    await Promise.resolve();

    const refreshPromise = element.refreshConfig();
    refreshedConfig.resolve(createAiConfig("custom-provider/new-primary"));
    await refreshPromise;

    const refreshedAiConfig = requireAiConfig(element);
    expect(refreshedAiConfig.primary_model).toBe("custom-provider/new-primary");
    expect(refreshedAiConfig.configured_providers.map((provider) => provider.name)).toEqual([
      "custom-provider",
    ]);

    initialConfig.resolve(createAiConfig("custom-provider/old-primary"));
    await loadPromise;

    const finalAiConfig = requireAiConfig(element);
    expect(finalAiConfig.primary_model).toBe("custom-provider/new-primary");
    expect(finalAiConfig.configured_providers.map((provider) => provider.name)).toEqual([
      "custom-provider",
    ]);
  });

  it("does not let an older loadData config error overwrite a newer refreshConfig result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const initialConfig = deferred<AIConfigOverview>();
    const refreshedConfig = deferred<AIConfigOverview>();

    invokeMock
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_official_providers");
        return [] satisfies OfficialProvider[];
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_ai_config");
        return initialConfig.promise;
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_ai_config");
        return refreshedConfig.promise;
      });

    const element = createElement();
    element.aiConfig = createAiConfig("custom-provider/seed");
    document.body.append(element);
    await element.updateComplete;
    element.aiConfig = null;

    const loadPromise = element.loadData();
    await Promise.resolve();

    const refreshPromise = element.refreshConfig();
    refreshedConfig.resolve(createAiConfig("custom-provider/new-primary"));
    await refreshPromise;

    initialConfig.reject(new Error("stale load failed"));
    await loadPromise;

    const finalAiConfig = requireAiConfig(element);
    expect(finalAiConfig.primary_model).toBe("custom-provider/new-primary");
  });
});

describe("config-custom-providers save behavior", () => {
  it("updates legacy inherited model api types when provider api type changes", async () => {
    let savePayload: Record<string, unknown> | null = null;

    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "save_provider") {
        savePayload = args ?? null;
        return "ok";
      }
      if (cmd === "get_official_providers") {
        return [] satisfies OfficialProvider[];
      }
      if (cmd === "get_ai_config") {
        return createAiConfig("legacy-provider/foo-large");
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const element = createElement();
    element.aiConfig = createAiConfig("legacy-provider/foo-large");
    element.editingProvider = {
      name: "legacy-provider",
      base_url: "https://legacy.example.com/v1",
      api_type: null,
      api_key_masked: "sk-****",
      has_api_key: true,
      models: [
        {
          full_id: "legacy-provider/foo-large",
          id: "foo-large",
          name: "Foo Large",
          api_type: "openai-completions",
          input: ["text"],
          context_window: 131072,
          max_tokens: 8192,
          reasoning: null,
          cost: null,
          is_primary: true,
        },
      ],
    };
    element.formProviderName = "legacy-provider";
    element.formBaseUrl = "https://legacy.example.com/v1";
    element.formApiKey = "";
    element.formApiType = "openai-responses";
    element.formSelectedModels = ["foo-large"];

    await element.handleSaveProvider();

    const payload = requireSavePayload(savePayload);
    expect(payload.apiType).toBe("openai-responses");
    expect(payload.models).toEqual([
      {
        id: "foo-large",
        name: "Foo Large",
        api: "openai-responses",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 8192,
      },
    ]);
  });

  it("surfaces a refresh warning when switching model succeeds but config refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    invokeMock
      .mockImplementationOnce(async (cmd, args) => {
        expect(cmd).toBe("switch_model");
        expect(args).toEqual({ modelId: "legacy-provider/foo-large" });
        return "ok";
      })
      .mockImplementationOnce(async (cmd) => {
        expect(cmd).toBe("get_ai_config");
        throw new Error("refresh failed");
      });

    const element = createElement();
    element.aiConfig = createAiConfig("legacy-provider/foo-large");
    document.body.append(element);
    await element.updateComplete;

    await element.handleSwitchModel("legacy-provider/foo-large");

    expect(element.error).toBe("模型已切换，但刷新配置失败，请手动刷新");
  });
});
