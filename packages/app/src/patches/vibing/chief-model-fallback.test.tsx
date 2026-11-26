/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  entries: undefined as ProviderSnapshotEntry[] | undefined,
  connected: true,
  setAgentModel: vi.fn(),
  setAgentThinkingOption: vi.fn(),
  store: null as null | {
    setState: (next: { sessions: Record<string, unknown> }) => void;
  },
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: state.entries }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    setAgentModel: state.setAgentModel,
    setAgentThinkingOption: state.setAgentThinkingOption,
  }),
  useHostRuntimeIsConnected: () => state.connected,
}));
vi.mock("@/stores/session-store", async () => {
  const { create } = await import("zustand");
  const store = create(() => ({ sessions: {} as Record<string, unknown> }));
  state.store = store;
  return {
    useSessionStore: store,
    selectAgentTurnPresentation: (session: { running?: Set<string> } | undefined, id: string) => ({
      isActive: session?.running?.has(id) ?? false,
    }),
  };
});

import {
  ChiefModelAutoReselect,
  resolveChiefModelAutoReselectTarget,
} from "./chief-model-fallback";

const readyEntry: ProviderSnapshotEntry = {
  provider: "codex",
  status: "ready",
  enabled: true,
  models: [
    {
      provider: "codex",
      id: "hidden-model",
      label: "Hidden",
      isSelectable: false,
      isDefault: true,
    },
    {
      provider: "codex",
      id: "relaydeck--gpt-6.2-sol",
      label: "GPT-6.2 Sol (Relaydeck)",
      aliases: ["relay-sol"],
      thinkingOptions: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      defaultThinkingOptionId: "medium",
    },
    {
      provider: "codex",
      id: "quotahub-self--gpt-6.2-sol",
      label: "GPT-6.2 Sol (QuotaHub)",
      isDefault: true,
      thinkingOptions: [{ id: "low", label: "Low", isDefault: true }],
      defaultThinkingOptionId: "low",
    },
  ],
};

describe("resolveChiefModelAutoReselectTarget", () => {
  it("returns null when the provider catalog is not ready or has no selectable models", () => {
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: { ...readyEntry, status: "loading" },
        configuredModelId: "gpt-6.2-sol",
        runtimeModelId: "gpt-6.2-sol",
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toBeNull();
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: { ...readyEntry, models: [] },
        configuredModelId: "gpt-6.2-sol",
        runtimeModelId: "gpt-6.2-sol",
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toBeNull();
  });

  it("returns null while Chief is running or when its model is already valid", () => {
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: readyEntry,
        configuredModelId: "gpt-6.2-sol",
        runtimeModelId: "gpt-6.2-sol",
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: true,
      }),
    ).toBeNull();
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: readyEntry,
        configuredModelId: "relay-sol",
        runtimeModelId: null,
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toBeNull();
  });

  it("picks the default selectable model and reconciles thinking when the current model is missing", () => {
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: readyEntry,
        configuredModelId: "gpt-6.2-sol",
        runtimeModelId: "gpt-6.2-sol",
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toEqual({
      invalidModelId: "gpt-6.2-sol",
      modelId: "quotahub-self--gpt-6.2-sol",
      thinkingOptionId: "low",
    });

    // Keeps current thinking when the fallback model supports it.
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: {
          ...readyEntry,
          models: [readyEntry.models![1]!],
        },
        configuredModelId: "hidden-model",
        runtimeModelId: null,
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toEqual({
      invalidModelId: "hidden-model",
      modelId: "relaydeck--gpt-6.2-sol",
    });

    // Clears thinking when the fallback model exposes no thinking options.
    expect(
      resolveChiefModelAutoReselectTarget({
        entry: {
          ...readyEntry,
          models: [{ provider: "codex", id: "plain-model", label: "Plain" }],
        },
        configuredModelId: "gpt-6.2-sol",
        runtimeModelId: null,
        explicitThinkingOptionId: "high",
        runtimeThinkingOptionId: null,
        isRunning: false,
      }),
    ).toEqual({
      invalidModelId: "gpt-6.2-sol",
      modelId: "plain-model",
      thinkingOptionId: null,
    });
  });
});

describe("ChiefModelAutoReselect", () => {
  beforeEach(() => {
    state.entries = [readyEntry];
    state.connected = true;
    state.setAgentModel.mockReset().mockResolvedValue(undefined);
    state.setAgentThinkingOption.mockReset().mockResolvedValue(null);
    state.store!.setState({
      sessions: {
        local: {
          running: new Set<string>(),
          agents: new Map([
            [
              "chief-1",
              {
                provider: "codex",
                cwd: "/work",
                model: "gpt-6.2-sol",
                runtimeInfo: { model: "gpt-6.2-sol", thinkingOptionId: "high" },
                thinkingOptionId: "high",
              },
            ],
          ]),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("auto-reselects a valid model and thinking level when active and skips while hidden", async () => {
    const view = render(
      <ChiefModelAutoReselect serverId="local" agentId="chief-1" cwd="/work" active={false} />,
    );
    expect(state.setAgentModel).not.toHaveBeenCalled();

    view.rerender(
      <ChiefModelAutoReselect serverId="local" agentId="chief-1" cwd="/work" active={true} />,
    );
    await vi.waitFor(() => {
      expect(state.setAgentModel).toHaveBeenCalledWith("chief-1", "quotahub-self--gpt-6.2-sol");
      expect(state.setAgentThinkingOption).toHaveBeenCalledWith("chief-1", "low");
    });
    expect(state.setAgentModel).toHaveBeenCalledTimes(1);
  });

  it("does not loop when setAgentModel fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.setAgentModel.mockRejectedValue(new Error("daemon busy"));
    const view = render(
      <ChiefModelAutoReselect serverId="local" agentId="chief-1" cwd="/work" active={true} />,
    );
    await vi.waitFor(() => expect(state.setAgentModel).toHaveBeenCalledTimes(1));
    await act(async () => {
      view.rerender(
        <ChiefModelAutoReselect serverId="local" agentId="chief-1" cwd="/work" active={true} />,
      );
      await Promise.resolve();
    });
    expect(state.setAgentModel).toHaveBeenCalledTimes(1);
    expect(state.setAgentThinkingOption).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
