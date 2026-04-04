// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeMock = vi.fn<TauriInvoke>();
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

  await import("./config-onestop.ts");
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
});

function requireSavedConfig(config: Record<string, unknown> | null): Record<string, unknown> {
  expect(config).not.toBeNull();
  if (!config) {
    throw new Error("saved config should be present");
  }
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireOnestopProvider(config: Record<string, unknown>): Record<string, unknown> {
  const provider = (
    (config.models as { providers?: Record<string, unknown> } | undefined)?.providers ?? {}
  ).onestop;
  expect(provider).toBeTruthy();
  if (!isRecord(provider)) {
    throw new Error("onestop provider should be present");
  }
  return provider;
}

describe("saveOnestopConfig persistence", () => {
  it("preserves existing onestop model extras and default-model metadata when switching", async () => {
    const { saveOnestopConfig } = await import("./config-onestop.ts");

    let savedConfig: Record<string, unknown> | null = null;
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "get_config") {
        return {
          models: {
            providers: {
              onestop: {
                baseUrl: "https://api.openclawcn.net/v1",
                api: "openai-completions",
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "OPENCLAW_ONESTOP_API_KEY",
                },
                headers: {
                  "X-Trace": "enabled",
                },
                models: [
                  {
                    id: "deepseek-chat",
                    name: "DeepSeek Chat",
                    api: "openai-completions",
                    input: ["text"],
                    contextWindow: 131072,
                    maxTokens: 4096,
                    reasoning: true,
                    cost: {
                      input: 1,
                      output: 2,
                      cacheRead: 3,
                      cacheWrite: 4,
                    },
                    compat: {
                      supportsStore: false,
                    },
                  },
                  {
                    id: "old-model",
                    name: "Old Model",
                  },
                ],
              },
            },
          },
          agents: {
            defaults: {
              models: {
                "onestop/deepseek-chat": {
                  alias: "fast-path",
                  params: {
                    temperature: 0.2,
                  },
                },
                "onestop/old-model": {
                  alias: "remove-me",
                },
              },
              model: {
                primary: "onestop/old-model",
              },
            },
          },
          meta: {
            lastTouchedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      }
      if (cmd === "save_config") {
        savedConfig = (args?.config ?? null) as Record<string, unknown> | null;
        return "ok";
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    await saveOnestopConfig("", "deepseek-chat");

    const persistedConfig = requireSavedConfig(savedConfig);
    const onestopProvider = requireOnestopProvider(persistedConfig);
    expect(onestopProvider.headers).toEqual({ "X-Trace": "enabled" });
    expect(onestopProvider.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "OPENCLAW_ONESTOP_API_KEY",
    });
    expect(onestopProvider.models).toEqual([
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        input: ["text"],
        contextWindow: 131072,
        maxTokens: 4096,
        reasoning: true,
        cost: {
          input: 1,
          output: 2,
          cacheRead: 3,
          cacheWrite: 4,
        },
        compat: {
          supportsStore: false,
        },
      },
    ]);

    const defaultsModels =
      (persistedConfig.agents as { defaults?: { models?: Record<string, unknown> } } | undefined)
        ?.defaults?.models ?? {};
    expect(defaultsModels["onestop/deepseek-chat"]).toEqual({
      alias: "fast-path",
      params: {
        temperature: 0.2,
      },
    });
    expect(defaultsModels["onestop/old-model"]).toBeUndefined();
    expect(
      (persistedConfig.agents as { defaults?: { model?: { primary?: string } } } | undefined)
        ?.defaults?.model?.primary ?? null,
    ).toBe("onestop/deepseek-chat");
  });
});
