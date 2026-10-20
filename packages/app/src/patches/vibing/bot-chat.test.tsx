// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeBotChatProps } from "./bot-chat-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/data/query-client";

const fake = vi.hoisted(() => ({
  visible: vi.fn(),
  prepare: vi.fn().mockResolvedValue(undefined),
  focused: true,
  cache: null as unknown,
}));
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => fake.focused }));
vi.mock("./bot-workspace", () => ({ BotWorkspaceBridge: () => null }));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => null,
  getEmbeddedWorkspaceDirectory: () => undefined,
}));
vi.mock("@/panels/agent-panel", async () => {
  const { useQueryClient } =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    AgentConversationPanel: () => {
      fake.cache = useQueryClient();
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
          agents: new Map(),
          agentDetails: new Map(),
          viewedTimelineSync: { replaceVisibleAgentIds: fake.visible },
        },
      },
    }),
}));
import { NativeBotChat, embeddedBotChatProps } from "./bot-chat";

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
