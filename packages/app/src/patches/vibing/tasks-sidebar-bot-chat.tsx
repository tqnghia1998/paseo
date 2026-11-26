import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native-unistyles";
import { QueryClientProvider } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import type { PaseoApi, PaseoWorkspaceAgentCreateOptions } from "@getpaseo/client";
import type { AgentProvider, JsonValue } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { queryClient } from "@/data/query-client";
import { AgentConversationPanel } from "@/panels/agent-panel";
import {
  PaneFocusProvider,
  PaneProvider,
  createPaneFocusContextValue,
  type PaneContextValue,
} from "@/panels/pane-context";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { AssistantFileLinkResolverProvider, type InlinePathTarget } from "@/assistant-file-links";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { SheetPaneHostProvider, type SheetPaneHost } from "@/screens/workspace/sheet-pane/host";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useSessionStore } from "@/stores/session-store";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { prefetchProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { NativeBotChatDraft } from "./bot-chat-draft";
import { BotChatForkProvider } from "./bot-chat-fork";
import {
  BotChatPanelLayer,
  useBotChatPanelStack,
  type BotChatPanelEntry,
  type BotChatPanelPane,
} from "./bot-chat-panels";
import { registerEmbeddedTargetOpener } from "./embedded-targets";
import { botChatDraftId } from "./bot-chat-scope";
import { useEmbeddedHostActive } from "./host-visibility";
import type { NativeBotChatProps } from "./bot-chat-types";

export interface TasksSidebarBotChatProps {
  serverId: string;
  paseo: PaseoApi;
  agentId: string;
  workspaceId: string | null;
  cwd: string | null;
  botName?: string | null;
  active: boolean;
  onSelectAgent: (agentId: string | null) => void;
}

interface BotRecord {
  id: string;
  name: string;
  provider: AgentProvider;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  mcpServerIds: string[];
  alwaysAllow: string[];
  contactBots: "ask" | "allow" | "off";
  archived: boolean;
  hostId: string | null;
  raw: Record<string, unknown>;
}

interface LibraryServerRecord {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface BotsSettingsSnapshot {
  bots: BotRecord[];
  mcpServers: LibraryServerRecord[];
}

type DraftStartMessage = Parameters<NativeBotChatProps["onStart"]>[0];

const BOT_LABEL = "paseo-bots.bot";
const CHAT_RUNTIME_LABEL = "paseo-bots.runtime";
const TOOLS_MCP_NAME = "bots";
const APPS_MCP_NAME = "apps";
const RESERVED_MCP_NAMES = new Set(["paseo", TOOLS_MCP_NAME, APPS_MCP_NAME]);
const QUIET_BOT_TOOLS = [
  "list_bots",
  "check_chat",
  "search_chats",
  "get_setup",
  "propose_skill",
  "propose_routine",
  "list_routines",
  "show_card",
];

function createFallbackBot(id: string, name: string, provider: AgentProvider): BotRecord {
  const now = new Date(0).toISOString();
  return {
    id,
    name,
    provider,
    model: null,
    modeId: null,
    thinkingOptionId: null,
    mcpServerIds: [],
    alwaysAllow: [],
    contactBots: "ask",
    archived: false,
    hostId: null,
    raw: {
      id,
      name,
      title: "",
      description: "",
      avatar: { kind: "sprite", sprite: "slime", palette: 0, accent: "pink" },
      hostId: null,
      provider,
      model: null,
      modeId: null,
      thinkingOptionId: null,
      soul: "",
      mcpServerIds: [],
      alwaysAllow: [],
      skillIds: [],
      apps: [],
      appRules: {},
      voice: { name: null, readReplies: false },
      contactBots: "ask",
      routines: [],
      playbooks: [],
      cwd: null,
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    },
  };
}

const FALLBACK_BOTS: readonly BotRecord[] = [
  createFallbackBot("vibing-general", "Codex", "codex"),
  createFallbackBot("vibing-claude", "Claude", "claude"),
];
const EMPTY_LIBRARY_SERVERS: readonly LibraryServerRecord[] = [];

function parseBotRecord(value: unknown): BotRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const provider = typeof item.provider === "string" ? (item.provider as AgentProvider) : null;
  if (!id || !name || !provider || id === "vibing-chief") return null;
  return {
    id,
    name,
    provider,
    model: typeof item.model === "string" ? item.model : null,
    modeId: typeof item.modeId === "string" ? item.modeId : null,
    thinkingOptionId: typeof item.thinkingOptionId === "string" ? item.thinkingOptionId : null,
    mcpServerIds: Array.isArray(item.mcpServerIds)
      ? item.mcpServerIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    alwaysAllow: Array.isArray(item.alwaysAllow)
      ? item.alwaysAllow.filter((entry): entry is string => typeof entry === "string")
      : [],
    contactBots:
      item.contactBots === "allow" || item.contactBots === "off" ? item.contactBots : "ask",
    archived: Boolean(item.archived),
    hostId: typeof item.hostId === "string" ? item.hostId : null,
    raw: item,
  };
}

function parseLibraryServers(value: unknown): LibraryServerRecord[] {
  if (!Array.isArray(value)) return [];
  const out: LibraryServerRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      entry.config &&
      typeof entry.config === "object"
    ) {
      out.push({
        id: entry.id,
        name: entry.name.trim(),
        enabled: entry.enabled !== false,
        config: entry.config as Record<string, unknown>,
      });
    }
  }
  return out;
}

async function fetchBotsSettings(client: DaemonClient): Promise<BotsSettingsSnapshot> {
  try {
    const response = (await client.invokePluginRpc("paseo-bots", "settings.bots.read", {})) as {
      status?: string;
      values?: { bots?: unknown; library?: { mcpServers?: unknown } };
    } | null;
    if (response?.status === "ready" && response.values) {
      const parsed = (Array.isArray(response.values.bots) ? response.values.bots : [])
        .map(parseBotRecord)
        .filter((bot): bot is BotRecord => bot !== null && !bot.archived && !bot.hostId);
      const mcpServers = parseLibraryServers(response.values.library?.mcpServers);
      if (parsed.length > 0) return { bots: parsed, mcpServers };
    }
  } catch {
    // Fall back to the built-in Vibing bots when plugin settings are unavailable.
  }
  return { bots: [...FALLBACK_BOTS], mcpServers: [] };
}

function pickBot(bots: readonly BotRecord[], botIdOrName: string | null | undefined): BotRecord {
  if (botIdOrName) {
    const match = bots.find((bot) => bot.id === botIdOrName || bot.name === botIdOrName);
    if (match) return match;
  }
  return bots.find((bot) => bot.id === "vibing-general") ?? bots[0] ?? FALLBACK_BOTS[0]!;
}

function buildBotMcpConfig(
  bot: BotRecord,
  libraryServers: readonly LibraryServerRecord[],
  mounted: { tools?: unknown; apps?: unknown },
) {
  const mcpServers: Record<string, unknown> = {};
  for (const serverId of bot.mcpServerIds) {
    const entry = libraryServers.find((item) => item.id === serverId);
    if (!entry?.enabled || !entry.name || RESERVED_MCP_NAMES.has(entry.name)) continue;
    if (entry.config.type !== "stdio" && entry.config.oauth === true) continue;
    mcpServers[entry.name] = entry.config;
  }
  if (mounted.apps && typeof mounted.apps === "object") mcpServers[APPS_MCP_NAME] = mounted.apps;
  if (mounted.tools && typeof mounted.tools === "object")
    mcpServers[TOOLS_MCP_NAME] = mounted.tools;
  return mcpServers;
}

function buildPreapprovedTools(
  bot: BotRecord,
  provider: string,
  mcpServers: Record<string, unknown>,
) {
  if (provider !== "claude" && provider !== "codex") return [];
  const quiet =
    TOOLS_MCP_NAME in mcpServers
      ? [...QUIET_BOT_TOOLS, ...(bot.contactBots === "allow" ? ["ask_bot"] : [])].map(
          (tool) => `${TOOLS_MCP_NAME}/${tool}`,
        )
      : [];
  return [...quiet, ...bot.alwaysAllow].flatMap((entry) => {
    const match = /^([^/\s]+)\/([^/\s]+)$/.exec(entry.trim());
    if (!match || !(match[1]! in mcpServers)) return [];
    return [{ kind: "mcp" as const, server: match[1]!, tool: match[2]! }];
  });
}

const normalizeDir = (value: string | null | undefined) => (value ?? "").replace(/\/+$/, "");

async function ensureStandaloneWorkspace(
  paseo: PaseoApi,
  bot: BotRecord,
  home: { root: string; path: string },
) {
  const { entries } = await paseo.workspaces.list({ filter: { includeBackground: true } });
  const existing = entries.find(
    (ws) =>
      ws.background === true &&
      normalizeDir(ws.workspaceDirectory ?? ws.projectRootPath) === normalizeDir(home.path),
  );
  if (existing) return paseo.workspaces.ref(existing);
  const { projects } = await paseo.projects.list();
  const project = projects.find(
    (entry) => normalizeDir(entry.projectRootPath) === normalizeDir(home.root),
  );
  return paseo.workspaces.create({
    title: bot.name,
    background: true,
    source: {
      kind: "directory",
      path: home.path,
      ...(project ? { projectId: project.projectId } : {}),
    },
  });
}

async function hydrateAgentInStore(
  client: DaemonClient,
  serverId: string,
  agentId: string,
): Promise<void> {
  try {
    const fetched = await client.fetchAgent({ agentId });
    if (!fetched) return;
    const normalized = normalizeAgentSnapshot(fetched.agent, serverId);
    const hydrated = applyLegacyDaemonWorkspaceOwnership({
      serverId,
      agent: { ...normalized, projectPlacement: fetched.project },
    });
    getHostRuntimeStore().acceptAgentSnapshot(serverId, hydrated);
  } catch {
    // Live session updates or AgentConversationPanel's own fetch will hydrate it.
  }
}

async function prepareTimelineSafe(serverId: string, agentId: string): Promise<void> {
  try {
    await getHostRuntimeStore().prepareAgentTimeline(serverId, agentId);
  } catch {
    // AgentConversationPanel surfaces load errors cleanly if timeline sync fails.
  }
}

function buildForkedAgentConfig(input: {
  bot: BotRecord;
  libraryServers: readonly LibraryServerRecord[];
  message: DraftStartMessage;
  promptResponse: { prompt?: string } | undefined;
  mountedResponse: { tools?: unknown; apps?: unknown } | undefined;
}): {
  provider: AgentProvider;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  config: PaseoWorkspaceAgentCreateOptions["config"];
} {
  const { bot, libraryServers, message, promptResponse, mountedResponse } = input;
  const choice = message.agentSettings;
  const provider = (choice?.provider ?? bot.provider) as AgentProvider;
  const model = choice ? choice.model : bot.model;
  const modeId = choice ? choice.modeId : bot.modeId;
  const thinkingOptionId = choice ? choice.thinkingOptionId : bot.thinkingOptionId;
  const mcpServers = buildBotMcpConfig(bot, libraryServers, mountedResponse ?? {});
  const preapprovedTools = buildPreapprovedTools(bot, provider, mcpServers);
  const systemPrompt = (promptResponse?.prompt ?? "").trim();

  const config: PaseoWorkspaceAgentCreateOptions["config"] = {
    provider: model ? `${provider}/${model}` : provider,
    ...(modeId ? { modeId } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(choice?.featureValues ? { options: { features: choice.featureValues } } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(Object.keys(mcpServers).length > 0
      ? {
          mcpServers: mcpServers as NonNullable<
            PaseoWorkspaceAgentCreateOptions["config"]
          >["mcpServers"],
        }
      : {}),
    ...(preapprovedTools.length > 0 ? { toolPolicy: { preapproved: preapprovedTools } } : {}),
  };

  return { provider, model, modeId, thinkingOptionId, config };
}

function buildForkedAgentLabels(input: {
  botId: string;
  provider: AgentProvider;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  message: DraftStartMessage;
}): Record<string, string> {
  const { botId, provider, model, modeId, thinkingOptionId, message } = input;
  if (!message.agentSettings || !message.inheritAgentSettings) {
    return { [BOT_LABEL]: botId };
  }
  return {
    [BOT_LABEL]: botId,
    [CHAT_RUNTIME_LABEL]: JSON.stringify({
      provider,
      model: model ?? null,
      modeId: modeId ?? null,
      thinkingOptionId: thinkingOptionId ?? null,
    }),
  };
}

async function startForkedSidebarChat(input: {
  client: DaemonClient;
  paseo: PaseoApi;
  serverId: string;
  bot: BotRecord;
  libraryServers: readonly LibraryServerRecord[];
  workspaceId: string | null;
  message: DraftStartMessage;
}): Promise<string> {
  const { client, paseo, serverId, bot, libraryServers, workspaceId, message } = input;
  const agentId = crypto.randomUUID();
  const home = (await client.invokePluginRpc("paseo-bots", "bots.ensure-home", {
    botId: bot.id,
  })) as { root: string; path: string };
  const workspaceHandle = workspaceId
    ? paseo.workspaces.ref(workspaceId)
    : await ensureStandaloneWorkspace(paseo, bot, home);
  const [promptResponse, mountedResponse] = await Promise.all([
    client.invokePluginRpc("paseo-bots", "bots.system-prompt", {
      bot: bot.raw,
      agentId,
    }) as Promise<{ prompt?: string }>,
    client.invokePluginRpc("paseo-bots", "bots.mount", {
      botId: bot.id,
      agentId,
    }) as Promise<{ tools?: unknown; apps?: unknown }>,
  ]);

  const built = buildForkedAgentConfig({
    bot,
    libraryServers,
    message,
    promptResponse,
    mountedResponse,
  });
  const labels = buildForkedAgentLabels({
    botId: bot.id,
    provider: built.provider,
    model: built.model,
    modeId: built.modeId,
    thinkingOptionId: built.thinkingOptionId,
    message,
  });

  const created = await workspaceHandle.agents.create({
    agentId,
    config: built.config,
    labels,
    prompt: message.text,
    ...(message.images.length > 0 ? { images: message.images } : {}),
    ...(message.attachments.length > 0
      ? { attachments: message.attachments as PaseoWorkspaceAgentCreateOptions["attachments"] }
      : {}),
    clientMessageId: message.messageId,
  });

  await hydrateAgentInStore(client, serverId, created.id);
  void queryClient.invalidateQueries({ queryKey: ["paseo-bots", "chats"] });
  return created.id;
}

export function EmbeddedTasksSidebarBotChat(props: TasksSidebarBotChatProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <FileDropZone style={styles.fill}>
        <SidebarBotChatSession {...props} />
      </FileDropZone>
    </QueryClientProvider>
  );
}

function SidebarBotChatPaneProviders(props: {
  pane: PaneContextValue;
  active: boolean;
  panelOpen: boolean;
  children: React.ReactNode;
}) {
  const focus = useMemo(
    () =>
      createPaneFocusContextValue({
        isWorkspaceFocused: props.active,
        isPaneFocused: props.active && !props.panelOpen,
      }),
    [props.active, props.panelOpen],
  );
  return (
    <DiffDocumentWorkspaceCacheProvider>
      <PaneProvider value={props.pane}>
        <PaneFocusProvider value={focus}>{props.children}</PaneFocusProvider>
      </PaneProvider>
    </DiffDocumentWorkspaceCacheProvider>
  );
}

function SidebarBotChatEnvironment(props: {
  client: DaemonClient | null;
  serverId: string;
  cwd: string;
  active: boolean;
  panelOpen: boolean;
  pane: PaneContextValue;
  onOpenWorkspaceFile: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  children: React.ReactNode;
}) {
  return (
    <AssistantFileLinkResolverProvider
      client={props.client}
      serverId={props.serverId}
      workspaceRoot={props.cwd || undefined}
      onOpenWorkspaceFile={props.onOpenWorkspaceFile}
    >
      <RetainedPanelActivity active={props.active}>
        <WorkspaceFocusProvider workspaceKey={null}>
          <SidebarBotChatPaneProviders
            pane={props.pane}
            active={props.active}
            panelOpen={props.panelOpen}
          >
            {props.children}
          </SidebarBotChatPaneProviders>
        </WorkspaceFocusProvider>
      </RetainedPanelActivity>
    </AssistantFileLinkResolverProvider>
  );
}

function buildSidebarPaneModels(input: {
  serverId: string;
  workspaceId: string;
  owner: string;
  currentAgentId: string | null;
  activeDraftId: string | null;
  panel: BotChatPanelEntry | null;
  retained: BotChatPanelEntry | null;
  panelAgentId: string | null;
  panelAgentWorkspaceId: string | null;
  openTarget: (target: WorkspaceTabTarget) => boolean;
  closePanel: () => void;
  setEntryState: (id: string, state: JsonValue) => void;
  onSelectChat: (agentId: string | null, draftId?: string) => void;
}): { pane: PaneContextValue; panelPanes: { pane: BotChatPanelPane; visible: boolean }[] } {
  const {
    serverId,
    workspaceId,
    owner,
    currentAgentId,
    activeDraftId,
    panel,
    retained,
    panelAgentId,
    panelAgentWorkspaceId,
    openTarget,
    closePanel,
    setEntryState,
    onSelectChat,
  } = input;

  const openTab: PaneContextValue["openTab"] = (target) => {
    if (!openTarget(target) && workspaceId) {
      navigateToWorkspace({ serverId, workspaceId, target });
    }
  };
  const shared = {
    serverId,
    host: "main" as const,
    openTab,
    openPreferredTarget: openTab,
    openTargetToSide: openTab,
    openFileInWorkspace: ({ location }: Parameters<PaneContextValue["openFileInWorkspace"]>[0]) =>
      openTab({ kind: "file", ...location }),
    openImportSheet: () => {},
  };
  const toPanelPane = (entry: BotChatPanelEntry): BotChatPanelPane => ({
    ...shared,
    workspaceId:
      (entry.target.kind === "agent" && entry.target.agentId === panelAgentId
        ? panelAgentWorkspaceId
        : null) || workspaceId,
    tabId: `${owner}:${entry.id}`,
    target: entry.target,
    state: entry.state,
    retargetCurrentTab: openTab,
    setCurrentTabState: (state) => setEntryState(entry.id, state),
    closeCurrentTab: closePanel,
  });

  return {
    pane: {
      ...shared,
      workspaceId,
      tabId: currentAgentId ?? activeDraftId ?? owner,
      target: currentAgentId
        ? { kind: "agent", agentId: currentAgentId }
        : { kind: "draft", draftId: activeDraftId ?? owner },
      retargetCurrentTab: (target) => {
        if (target.kind === "agent") onSelectChat(target.agentId);
        else openTab(target);
      },
      setCurrentTabState: () => {},
      closeCurrentTab: () => onSelectChat(null),
    },
    panelPanes: [
      ...(panel ? [{ pane: toPanelPane(panel), visible: true }] : []),
      ...(retained ? [{ pane: toPanelPane(retained), visible: false }] : []),
    ],
  };
}

function useSidebarBotContext(props: TasksSidebarBotChatProps, active: boolean) {
  const { serverId } = props;
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const botsQuery = useFetchQuery({
    queryKey: ["vibing", "tasks-sidebar-bots", serverId],
    dataShape: "value",
    staleTimeMs: 15_000,
    queryFn: () =>
      client
        ? fetchBotsSettings(client)
        : Promise.resolve({ bots: [...FALLBACK_BOTS], mcpServers: EMPTY_LIBRARY_SERVERS }),
    enabled: Boolean(client && connected),
  });
  const cachedAgent = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return session?.agents.get(props.agentId) ?? session?.agentDetails.get(props.agentId) ?? null;
  });
  const workspaceId = props.workspaceId || cachedAgent?.workspaceId || "";
  const cwd = cachedAgent?.cwd || props.cwd || "";
  const botLabel = cachedAgent?.labels?.[BOT_LABEL] ?? props.botName ?? null;
  const bot = pickBot(botsQuery.data?.bots ?? FALLBACK_BOTS, botLabel);
  const libraryServers = botsQuery.data?.mcpServers ?? EMPTY_LIBRARY_SERVERS;

  useEffect(() => {
    if (active && connected && client && cwd) {
      prefetchProvidersSnapshot(serverId, client, { cwd });
    }
  }, [active, client, connected, cwd, serverId]);

  return { client, workspaceId, cwd, bot, libraryServers };
}

function useViewedSidebarTimeline(input: {
  serverId: string;
  active: boolean;
  owner: string;
  visibleAgentId: string | null;
}) {
  const { serverId, active, owner, visibleAgentId } = input;
  useEffect(() => {
    if (!visibleAgentId || !active) return;
    void prepareTimelineSafe(serverId, visibleAgentId);
  }, [active, serverId, visibleAgentId]);

  const sync = useSessionStore((state) => state.sessions[serverId]?.viewedTimelineSync ?? null);
  useLayoutEffect(() => {
    if (!sync) return;
    sync.replaceVisibleAgentIds(owner, active && visibleAgentId ? [visibleAgentId] : []);
    return () => sync.replaceVisibleAgentIds(owner, []);
  }, [active, owner, sync, visibleAgentId]);
}

function buildSidebarSheetPaneHost(input: {
  serverId: string;
  workspaceId: string;
  active: boolean;
  pane: PaneContextValue;
}): SheetPaneHost | null {
  const { serverId, workspaceId, active, pane } = input;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  if (!workspaceKey) return null;
  return {
    workspaceKey,
    serverId,
    workspaceId,
    isWorkspaceFocused: active,
    buildContent: (tab, closeCurrentTab) =>
      buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: serverId,
        normalizedWorkspaceId: workspaceId,
        host: "sheet",
        onOpenTab: pane.openTab,
        onOpenPreferredTarget: pane.openPreferredTarget,
        onOpenTargetToSide: pane.openTargetToSide,
        onCloseCurrentTab: closeCurrentTab,
        onRetargetCurrentTab: pane.openTab,
        onSetCurrentTabState: (state) =>
          useWorkspaceLayoutStore.getState().setTabState(workspaceKey, tab.tabId, state),
        onOpenWorkspaceFile: pane.openFileInWorkspace,
        onOpenImportSheet: pane.openImportSheet,
      }),
  };
}

function SidebarBotChatSession(props: TasksSidebarBotChatProps) {
  const { serverId, paseo, onSelectAgent } = props;
  const focused = useIsFocused();
  const hostActive = useEmbeddedHostActive();
  const active = focused && props.active && hostActive;
  const [forkDraft, setForkDraft] = useState<{ forAgentId: string; draftId: string } | null>(null);
  const activeDraftId = forkDraft?.forAgentId === props.agentId ? forkDraft.draftId : null;
  const currentAgentId = activeDraftId ? null : props.agentId;

  const { client, workspaceId, cwd, bot, libraryServers } = useSidebarBotContext(props, active);
  const panels = useBotChatPanelStack(currentAgentId ?? activeDraftId);
  const panel = panels.top;
  const panelAgentId = panel?.target.kind === "agent" ? panel.target.agentId : null;
  const panelAgentWorkspaceId = useSessionStore((state) => {
    if (!panelAgentId) return null;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(panelAgentId) ?? session?.agentDetails.get(panelAgentId);
    return agent?.workspaceId ?? null;
  });

  const instanceId = useId();
  const owner = `tasks-sidebar:${serverId}:${instanceId}`;
  useViewedSidebarTimeline({
    serverId,
    active,
    owner,
    visibleAgentId: panelAgentId ?? currentAgentId,
  });

  const isCurrentFork = forkDraft?.forAgentId === props.agentId;
  const onSelectChat = useCallback(
    (nextAgentId: string | null, nextDraftId?: string) => {
      if (nextAgentId) {
        setForkDraft(null);
        onSelectAgent(nextAgentId);
        return;
      }
      if (nextDraftId) {
        setForkDraft({ forAgentId: props.agentId, draftId: nextDraftId });
        return;
      }
      if (isCurrentFork) {
        setForkDraft(null);
        return;
      }
      onSelectAgent(null);
    },
    [isCurrentFork, onSelectAgent, props.agentId],
  );

  const { open: openPanel, back: closePanel, close: closePanels, setEntryState } = panels;
  const openTarget = useCallback(
    (target: WorkspaceTabTarget): boolean => {
      if (target.kind === "draft") {
        onSelectChat(null, target.draftId);
        return true;
      }
      if (target.kind === "agent" && target.agentId === currentAgentId) {
        closePanels();
        return true;
      }
      return openPanel(target);
    },
    [closePanels, currentAgentId, onSelectChat, openPanel],
  );

  useEffect(() => {
    if (!active) return;
    return registerEmbeddedTargetOpener({ serverId, agentId: currentAgentId, open: openTarget });
  }, [active, currentAgentId, openTarget, serverId]);

  const { pane, panelPanes } = useMemo(
    () =>
      buildSidebarPaneModels({
        serverId,
        workspaceId,
        owner,
        currentAgentId,
        activeDraftId,
        panel,
        retained: panels.retained,
        panelAgentId,
        panelAgentWorkspaceId,
        openTarget,
        closePanel,
        setEntryState,
        onSelectChat,
      }),
    [
      activeDraftId,
      closePanel,
      currentAgentId,
      onSelectChat,
      openTarget,
      owner,
      panel,
      panelAgentId,
      panelAgentWorkspaceId,
      panels.retained,
      serverId,
      setEntryState,
      workspaceId,
    ],
  );

  const sheetPaneHost = useMemo(
    () => buildSidebarSheetPaneHost({ serverId, workspaceId, active, pane }),
    [active, pane, serverId, workspaceId],
  );
  const openForkDraft = useCallback(
    (draftId: string) => pane.openTab({ kind: "draft", draftId }),
    [pane],
  );
  const openFileLink = useCallback(
    (target: InlinePathTarget, disposition: OpenFileDisposition) => {
      pane.openFileInWorkspace({
        location: { path: target.path, lineStart: target.lineStart, lineEnd: target.lineEnd },
        disposition,
      });
    },
    [pane],
  );
  const startDraft = useCallback(
    async (message: DraftStartMessage) => {
      if (!client) throw new Error("Paseo host is offline.");
      const createdId = await startForkedSidebarChat({
        client,
        paseo,
        serverId,
        bot,
        libraryServers,
        workspaceId: workspaceId || null,
        message,
      });
      setForkDraft(null);
      onSelectAgent(createdId);
      return createdId;
    },
    [bot, client, libraryServers, onSelectAgent, paseo, serverId, workspaceId],
  );

  return (
    <SidebarBotChatEnvironment
      client={client}
      serverId={serverId}
      cwd={cwd}
      active={active}
      panelOpen={Boolean(panel)}
      pane={pane}
      onOpenWorkspaceFile={openFileLink}
    >
      <BotChatForkProvider
        openDraft={openForkDraft}
        draftIdPrefix={botChatDraftId(bot.id, workspaceId || cwd || "standalone")}
      >
        <SheetPaneHostProvider value={sheetPaneHost}>
          <BotChatPanelLayer
            panes={panelPanes}
            active={active}
            onBack={closePanel}
            testID="tasks-sidebar-bot-chat-layer"
          >
            {currentAgentId ? (
              <AgentConversationPanel />
            ) : (
              <NativeBotChatDraft
                serverId={serverId}
                botId={bot.id}
                draftId={activeDraftId ?? undefined}
                workspaceId={workspaceId || null}
                cwd={cwd}
                provider={bot.provider}
                model={bot.model}
                modeId={bot.modeId}
                thinkingOptionId={bot.thinkingOptionId}
                active={active && !panel}
                onStart={startDraft}
              />
            )}
          </BotChatPanelLayer>
        </SheetPaneHostProvider>
      </BotChatForkProvider>
    </SidebarBotChatEnvironment>
  );
}

const styles = StyleSheet.create(() => ({
  fill: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
}));
