// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CreateAgentPreferencesService,
  createAgentPreferencesService,
} from "@/create-agent-preferences/service";

import {
  mergeProviderPreferences,
  useFormPreferences,
  FormPreferencesScopeContext,
} from "./use-form-preferences";

describe("mergeProviderPreferences", () => {
  it("stores the selected model for a provider", () => {
    expect(
      mergeProviderPreferences({
        preferences: {},
        provider: "claude",
        updates: { model: "claude-opus-4-6" },
      }),
    ).toEqual({
      provider: "claude",
      providerPreferences: {
        claude: {
          model: "claude-opus-4-6",
        },
      },
    });
  });

  it("merges thinking preferences by model without dropping existing entries", () => {
    expect(
      mergeProviderPreferences({
        preferences: {
          provider: "claude",
          providerPreferences: {
            claude: {
              model: "claude-sonnet-4-6",
              thinkingByModel: {
                "claude-sonnet-4-6": "medium",
              },
            },
          },
        },
        provider: "claude",
        updates: {
          thinkingByModel: {
            "claude-opus-4-6": "high",
          },
        },
      }),
    ).toEqual({
      provider: "claude",
      providerPreferences: {
        claude: {
          model: "claude-sonnet-4-6",
          thinkingByModel: {
            "claude-sonnet-4-6": "medium",
            "claude-opus-4-6": "high",
          },
        },
      },
    });
  });

  it("merges feature values without dropping existing entries", () => {
    expect(
      mergeProviderPreferences({
        preferences: {
          provider: "codex",
          providerPreferences: {
            codex: {
              model: "gpt-5.4",
              featureValues: {
                fast_mode: true,
              },
            },
          },
        },
        provider: "codex",
        updates: {
          featureValues: {
            plan_mode: true,
          },
        },
      }),
    ).toEqual({
      provider: "codex",
      providerPreferences: {
        codex: {
          model: "gpt-5.4",
          featureValues: {
            fast_mode: true,
            plan_mode: true,
          },
        },
      },
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps a bot draft's preferences separate from global defaults and other drafts", async () => {
  const global = {
    provider: "claude",
    providerPreferences: { claude: { model: "remembered", mode: "bypassPermissions" } },
  };
  const loadGlobal = vi.spyOn(createAgentPreferencesService, "load").mockResolvedValue(global);
  const updateGlobal = vi.spyOn(createAgentPreferencesService, "update");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["form-preferences"], global);
  const write = vi.fn(async () => {});
  const service = new CreateAgentPreferencesService({ read: async () => null, write });
  const scope = { id: "bot-draft-one", service };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(FormPreferencesScopeContext.Provider, { value: scope }, children),
    );
  const first = renderHook(() => useFormPreferences(), { wrapper });
  await waitFor(() => expect(first.result.current.isLoading).toBe(false));
  expect(first.result.current.preferences).toEqual({});
  await act(async () => {
    await first.result.current.updatePreferences({
      provider: "codex",
      providerPreferences: { codex: { model: "chosen" } },
    });
  });
  await waitFor(() =>
    expect(first.result.current.preferences).toEqual({
      provider: "codex",
      providerPreferences: { codex: { model: "chosen" } },
    }),
  );
  expect(loadGlobal).not.toHaveBeenCalled();
  expect(updateGlobal).not.toHaveBeenCalled();
  expect(client.getQueryData(["form-preferences"])).toEqual(global);
  first.unmount();
  const secondScope = {
    id: "bot-draft-two",
    service: new CreateAgentPreferencesService({ read: async () => null, write: async () => {} }),
  };
  const second = renderHook(() => useFormPreferences(), {
    wrapper: ({ children }) =>
      createElement(
        QueryClientProvider,
        { client },
        createElement(FormPreferencesScopeContext.Provider, { value: secondScope }, children),
      ),
  });
  await waitFor(() => expect(second.result.current.isLoading).toBe(false));
  expect(second.result.current.preferences).toEqual({});
  const ordinary = renderHook(() => useFormPreferences(), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
  });
  expect(ordinary.result.current.preferences).toEqual(global);
  client.clear();
});
