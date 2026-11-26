import { useEffect, useMemo, useRef } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { useShallow } from "zustand/react/shallow";
import {
  resolveAgentModelSelection,
  resolveProviderSnapshotEntry,
} from "@/composer/agent-controls/utils";
import { queryClient } from "@/data/query-client";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { selectAgentTurnPresentation, useSessionStore } from "@/stores/session-store";

export interface ChiefModelAutoReselectInput {
  entry: ProviderSnapshotEntry | null | undefined;
  configuredModelId: string | null | undefined;
  runtimeModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
  runtimeThinkingOptionId: string | null | undefined;
  isRunning: boolean;
}

export interface ChiefModelAutoReselectTarget {
  /** Key representing the invalid selection being replaced, for retry deduplication. */
  invalidModelId: string;
  modelId: string;
  /** Defined only when the agent's current thinking level must be updated for `modelId`. */
  thinkingOptionId?: string | null;
}

function resolveFallbackThinkingOptionId(
  model: AgentModelDefinition,
  currentThinkingId: string | null | undefined,
): string | null | undefined {
  const options = model.thinkingOptions;
  const trimmed = typeof currentThinkingId === "string" ? currentThinkingId.trim() : "";
  if (!options || options.length === 0) {
    return trimmed ? null : undefined;
  }
  if (trimmed && options.some((option) => option.id === trimmed)) {
    return undefined;
  }
  return (
    model.defaultThinkingOptionId ??
    options.find((option) => option.isDefault)?.id ??
    options[0]?.id
  );
}

/**
 * When Chief's active model is no longer in its provider's ready selectable catalog,
 * returns the provider's default (or first) selectable model to auto-reselect.
 */
export function resolveChiefModelAutoReselectTarget(
  input: ChiefModelAutoReselectInput,
): ChiefModelAutoReselectTarget | null {
  if (input.isRunning) return null;
  if (!input.entry || input.entry.status !== "ready") return null;
  const models = filterSelectableModels(input.entry.models ?? null);
  if (!models || models.length === 0) return null;

  const selection = resolveAgentModelSelection({
    models,
    runtimeModelId: input.runtimeModelId,
    configuredModelId: input.configuredModelId,
    runtimeThinkingOptionId: input.runtimeThinkingOptionId,
    explicitThinkingOptionId: input.explicitThinkingOptionId,
  });
  if (selection.selectedModel !== null) return null;

  const fallback = models.find((model) => model.isDefault) ?? models[0];
  if (!fallback) return null;

  const currentThinking =
    input.explicitThinkingOptionId && input.explicitThinkingOptionId !== "default"
      ? input.explicitThinkingOptionId
      : input.runtimeThinkingOptionId;
  const thinkingOptionId = resolveFallbackThinkingOptionId(fallback, currentThinking);

  return {
    invalidModelId: selection.activeModelId ?? "",
    modelId: fallback.id,
    ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
  };
}

function ChiefModelAutoReselectContent({
  serverId,
  agentId,
  cwd,
  active,
}: {
  serverId: string;
  agentId: string;
  cwd: string;
  active: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const agent = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const current = session?.agents?.get(agentId) ?? null;
      if (!current) return null;
      return {
        provider: current.provider,
        cwd: current.cwd,
        model: current.model ?? null,
        runtimeModelId: current.runtimeInfo?.model ?? null,
        thinkingOptionId: current.thinkingOptionId ?? null,
        runtimeThinkingOptionId: current.runtimeInfo?.thinkingOptionId ?? null,
        isRunning: selectAgentTurnPresentation(session, agentId).isActive,
      };
    }),
  );
  const { entries } = useProvidersSnapshot(serverId, {
    cwd: agent?.cwd ?? cwd,
    enabled: active && Boolean(agent),
  });
  const entry = useMemo(
    () => resolveProviderSnapshotEntry(entries, agent?.provider),
    [agent?.provider, entries],
  );
  const target = useMemo(
    () =>
      agent
        ? resolveChiefModelAutoReselectTarget({
            entry,
            configuredModelId: agent.model,
            runtimeModelId: agent.runtimeModelId,
            explicitThinkingOptionId: agent.thinkingOptionId,
            runtimeThinkingOptionId: agent.runtimeThinkingOptionId,
            isRunning: agent.isRunning,
          })
        : null,
    [agent, entry],
  );
  const lastAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!target) {
      lastAttemptedRef.current = null;
      return;
    }
    if (!active || !connected || !client?.setAgentModel) return;
    const attemptKey = `${agentId}\0${target.invalidModelId}\0${target.modelId}`;
    if (lastAttemptedRef.current === attemptKey) return;
    lastAttemptedRef.current = attemptKey;

    let cancelled = false;
    void (async () => {
      try {
        await client.setAgentModel(agentId, target.modelId);
        if (!cancelled && target.thinkingOptionId !== undefined && client.setAgentThinkingOption) {
          await client.setAgentThinkingOption(agentId, target.thinkingOptionId);
        }
      } catch (error) {
        console.warn("[Chief] auto-reselect model failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, agentId, client, connected, target]);

  return null;
}

export function ChiefModelAutoReselect({
  serverId,
  agentId,
  cwd,
  active,
}: {
  serverId: string;
  agentId: string;
  cwd: string;
  active: boolean;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ChiefModelAutoReselectContent
        serverId={serverId}
        agentId={agentId}
        cwd={cwd}
        active={active}
      />
    </QueryClientProvider>
  );
}
