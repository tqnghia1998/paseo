// @vitest-environment jsdom
import React, { type ReactNode, type ContextType } from "react";
import { act, cleanup, render as renderComponent, screen } from "@testing-library/react";
import { NavigationContext } from "expo-router/build/react-navigation/core/NavigationContext";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeBotChatProps } from "./bot-chat-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";

const fake = vi.hoisted(() => ({
  visible: vi.fn(),
  prepare: vi.fn().mockResolvedValue(undefined),
  focused: true,
  cache: null as unknown,
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
vi.mock("@react-navigation/native", async () => ({
  ...(await vi.importActual("@react-navigation/core")),
}));
vi.mock("expo-router", async () => ({
  useRouter: () => ({ push: vi.fn() }),
  ...(await vi.importActual("expo-router/build/react-navigation/core/useIsFocused")),
}));
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

it("only supplies the native chat slot to Bots", () => {
  expect(embeddedBotChatProps("paseo-bots")).toMatchObject({
    nativeChat: NativeBotChat,
    botWorkspace: { id: "", directory: "" },
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
