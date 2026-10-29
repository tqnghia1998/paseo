// @vitest-environment jsdom
import React, { type ReactNode, type ContextType } from "react";
import { act, cleanup, render as renderComponent, screen } from "@testing-library/react";
import { NavigationContext } from "expo-router/build/react-navigation/core/NavigationContext";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeBotChatProps } from "./bot-chat-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSheetPaneHost } from "@/screens/workspace/sheet-pane/host";
import { buildWorkspacePaneContentModel } from "@/screens/workspace/workspace-pane-content";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";

const fake = vi.hoisted(() => ({
  visible: vi.fn(),
  prepare: vi.fn().mockResolvedValue(undefined),
  focused: true,
  cache: null as unknown,
  sheetHost: null as ReturnType<typeof useSheetPaneHost> | null,
  fork: undefined as (() => Promise<void>) | undefined,
  buildForkContext: vi.fn().mockResolvedValue({
    attachment: {
      type: "text",
      title: "Chat history",
      mimeType: "text/plain",
      text: "Earlier conversation",
    },
    itemCount: 3,
  }),
}));
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock(
  "expo-router/react-navigation",
  async () => await vi.importActual("expo-router/build/react-navigation/core"),
);
vi.mock("@react-navigation/native", async () => ({
  ...(await vi.importActual("@react-navigation/core")),
}));
vi.mock("expo-router", async () => ({
  useRouter: () => ({ push: vi.fn() }),
  ...(await vi.importActual("expo-router/build/react-navigation/core/useIsFocused")),
}));
vi.mock("./bot-usage-card", () => ({ BotUsageCard: () => null }));
vi.mock("@/composer/editing-session", () => ({
  useComposerEditingEnvironmentBridge: () => (node: ReactNode) => node,
}));
vi.mock("@/screens/workspace/workspace-pane-content", () => ({
  buildWorkspacePaneContentModel: vi.fn(),
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: { getState: () => ({ setTabState: vi.fn() }) },
}));
// Subagent panels register every workspace panel; these tests only open the chat itself.
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: () => {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./bot-workspace", () => ({ BotWorkspaceBridge: () => null }));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => null,
  getEmbeddedWorkspaceDirectory: () => undefined,
}));
vi.mock("@/panels/agent-panel", async () => {
  const { useQueryClient } =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  const { useForkAgent } = await import("@/hooks/use-fork-agent");
  return {
    AgentConversationPanel: () => {
      fake.cache = useQueryClient();
      fake.sheetHost = useSheetPaneHost();
      const fork = useForkAgent({ serverId: "host" });
      fake.fork = () =>
        fork({
          agentId: "chat",
          workspaceId: "workspace",
          target: "tab",
          agent: { provider: "codex", cwd: "/bot" } as Parameters<typeof fork>[0]["agent"],
          boundary: { boundaryMessageId: "turn-end" },
        });
      return <div data-testid="native-panel" />;
    },
  };
});
vi.mock("./bot-chat-draft", () => ({
  NativeBotChatDraft: () => <div data-testid="native-draft" />,
}));
vi.mock("@/panels/pane-context", () => ({
  PaneProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PaneFocusProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  createPaneFocusContextValue: () => ({}),
}));
vi.mock("@/workspace/focus", () => ({
  WorkspaceFocusProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/git/diff-document/workspace-cache", () => ({
  DiffDocumentWorkspaceCacheProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/assistant-file-links", () => ({
  AssistantFileLinkResolverProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ prepareAgentTimeline: fake.prepare }),
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => false,
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: vi.fn() }));
vi.mock("@/hooks/use-providers-snapshot", () => ({ prefetchProvidersSnapshot: vi.fn() }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({
      sessions: {
        host: {
          client: { buildAgentForkContext: fake.buildForkContext },
          serverInfo: { features: { agentForkContext: true } },
          agents: new Map(),
          agentDetails: new Map(),
          viewedTimelineSync: { replaceVisibleAgentIds: fake.visible },
        },
      },
    }),
}));
import { NativeBotChat, embeddedBotChatProps } from "./bot-chat";
import { BotUsageCard } from "./bot-usage-card";

// Expo Router owns a different navigation context from @react-navigation/native.
const navigation = {
  isFocused: () => fake.focused,
  addListener: () => () => {},
} as unknown as ContextType<typeof NavigationContext>;
function render(ui: React.ReactNode) {
  return renderComponent(ui, {
    wrapper: ({ children }) => (
      <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
    ),
  });
}

const props: NativeBotChatProps = {
  serverId: "host",
  botId: "bot",
  agentId: null,
  workspaceId: "workspace",
  cwd: "/bot",
  provider: "codex",
  active: true,
  onSelectChat: vi.fn(),
  onStart: vi.fn(),
};
beforeEach(() => {
  fake.visible.mockClear();
  fake.prepare.mockClear();
  fake.focused = true;
  vi.mocked(props.onSelectChat).mockClear();
  vi.mocked(navigateToWorkspace).mockClear();
  useWorkspaceAttachmentsStore.setState({ attachmentsByScope: {} });
});
afterEach(cleanup);

it("hands a newly created bot chat to the native panel and releases visibility when hidden or unmounted", () => {
  const view = render(<NativeBotChat {...props} />);
  expect(screen.getByTestId("native-draft")).toBeTruthy();
  expect(fake.prepare).not.toHaveBeenCalled();
  view.rerender(<NativeBotChat {...props} agentId="chat" />);
  expect(screen.getByTestId("native-panel")).toBeTruthy();
  expect(fake.prepare).toHaveBeenCalledWith("host", "chat");
  expect(fake.visible).toHaveBeenLastCalledWith(expect.any(String), ["chat"]);
  fake.focused = false;
  view.rerender(<NativeBotChat {...props} agentId="chat" />);
  expect(fake.visible).toHaveBeenLastCalledWith(expect.any(String), []);
  view.unmount();
  expect(fake.visible).toHaveBeenLastCalledWith(expect.any(String), []);
});

it("provides the workspace sheet host required by existing chats and subagent tracks", () => {
  render(<NativeBotChat {...props} agentId="chat" />);
  expect(fake.sheetHost).toMatchObject({
    serverId: "host",
    workspaceId: "workspace",
    isWorkspaceFocused: true,
    buildContent: expect.any(Function),
  });
  const close = vi.fn();
  const tab = {
    key: "child",
    tabId: "child",
    kind: "agent" as const,
    target: { kind: "agent" as const, agentId: "child" },
  };
  fake.sheetHost!.buildContent(tab, close);
  expect(buildWorkspacePaneContentModel).toHaveBeenCalledWith(
    expect.objectContaining({
      tab,
      host: "sheet",
      normalizedServerId: "host",
      normalizedWorkspaceId: "workspace",
      onCloseCurrentTab: close,
    }),
  );
});

it("only supplies the native chat and sidebar usage slots to Bots", () => {
  expect(embeddedBotChatProps("paseo-bots")).toMatchObject({
    nativeChat: NativeBotChat,
    botWorkspace: { id: "", directory: "" },
    sidebarFooter: BotUsageCard,
  });
  expect(embeddedBotChatProps("mermaid")).toEqual({});
});

it("uses the app query cache for native controls inside a plugin's isolated cache", () => {
  const pluginCache = new QueryClient();
  render(
    <QueryClientProvider client={pluginCache}>
      <NativeBotChat {...props} agentId="chat" />
    </QueryClientProvider>,
  );
  expect(fake.cache).toBe(queryClient);
  expect(fake.cache).not.toBe(pluginCache);
});

it("opens a fork in the same bot with the draft that owns its bounded history", async () => {
  render(<NativeBotChat {...props} agentId="chat" />);
  await act(async () => fake.fork!());
  expect(props.onSelectChat).toHaveBeenCalledWith(null, expect.any(String));
  const draftId = vi.mocked(props.onSelectChat).mock.calls[0][1]!;
  expect(draftId).toMatch(/^paseo-bots:bot:workspace:draft_/);
  expect(
    useWorkspaceAttachmentsStore.getState().attachmentsByScope[
      buildDraftWorkspaceAttachmentScopeKey(draftId)
    ],
  ).toEqual([
    expect.objectContaining({
      kind: "chat_history",
      source: expect.objectContaining({ agentId: "chat", itemCount: 3 }),
    }),
  ]);
  expect(fake.buildForkContext).toHaveBeenCalledWith("chat", { boundaryMessageId: "turn-end" });
  expect(navigateToWorkspace).not.toHaveBeenCalled();
});
