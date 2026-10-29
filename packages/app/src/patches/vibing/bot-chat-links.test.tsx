// @vitest-environment jsdom
import React, { type ReactNode, type ContextType } from "react";
import { act, cleanup, fireEvent, render as renderComponent, screen } from "@testing-library/react";
import { NavigationContext } from "expo-router/build/react-navigation/core/NavigationContext";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeBotChatProps } from "./bot-chat-types";
import { usePaneContext, type PaneContextValue } from "@/panels/pane-context";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { openEmbeddedTarget } from "./embedded-targets";

const fake = vi.hoisted(() => ({
  visible: vi.fn(),
  prepare: vi.fn().mockResolvedValue(undefined),
  openFile: vi.fn((location: { path: string }) => !location.path.startsWith("/outside")),
  panels: new Map<string, PaneContextValue>(),
}));
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS = "true";
});
vi.mock(
  "expo-router/react-navigation",
  async () => await vi.importActual("expo-router/build/react-navigation/core"),
);
vi.mock("@/composer/editing-session", () => ({
  useComposerEditingEnvironmentBridge: () => (node: ReactNode) => node,
}));
vi.mock("@/screens/workspace/workspace-pane-content", () => ({
  buildWorkspacePaneContentModel: vi.fn(),
}));
vi.mock("@/stores/workspace-layout-store", () => ({
  useWorkspaceLayoutStore: { getState: () => ({ setTabState: vi.fn() }) },
}));
vi.mock("@react-navigation/native", async () => ({
  ...(await vi.importActual("@react-navigation/core")),
}));
vi.mock("expo-router", async () => ({
  useRouter: () => ({ push: vi.fn() }),
  ...(await vi.importActual("expo-router/build/react-navigation/core/useIsFocused")),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./bot-usage-card", () => ({ BotUsageCard: () => null }));
vi.mock("./bot-workspace", () => ({ BotWorkspaceBridge: () => null }));
vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => null,
  getEmbeddedWorkspaceDirectory: () => undefined,
}));
vi.mock("./host-file-open", () => ({ openFileInHost: fake.openFile }));
vi.mock("./bot-chat-draft", () => ({
  NativeBotChatDraft: () => <div data-testid="native-draft" />,
}));

// Stands in for every pane panel: shows its target and records the pane its links use.
function FakePanel() {
  const pane = usePaneContext();
  fake.panels.set(JSON.stringify(pane.target), pane);
  return <div data-testid="panel" data-target={JSON.stringify(pane.target)} />;
}
vi.mock("@/panels/agent-panel", () => ({ AgentConversationPanel: FakePanel }));
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: () => {} }));
vi.mock("@/panels/panel-registry", () => ({
  getPanelRegistration: () => ({
    component: FakePanel,
    useDescriptor: (target: WorkspaceTabTarget) => ({
      label:
        { agent: "Child agent", provider_subagent: "Explore task" }[target.kind as string] ??
        target.kind,
    }),
  }),
}));
vi.mock("@/components/headers/back-header", () => ({
  BackHeader: ({ title, onBack }: { title?: string; onBack?: () => void }) => (
    <button type="button" onClick={onBack}>
      back from {title}
    </button>
  ),
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
          agents: new Map([["child", { workspaceId: "other-workspace", cwd: "/bot" }]]),
          agentDetails: new Map(),
          viewedTimelineSync: { replaceVisibleAgentIds: fake.visible },
        },
      },
    }),
}));
import { NativeBotChat } from "./bot-chat";

const navigation = {
  isFocused: () => true,
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
  agentId: "chat",
  workspaceId: "workspace",
  cwd: "/bot",
  provider: "claude",
  active: true,
  onSelectChat: vi.fn(),
  onStart: vi.fn(),
};
const chat = { kind: "agent", agentId: "chat" } as const;
const provider = { kind: "provider_subagent", parentAgentId: "chat", subagentId: "sub" } as const;
const child = { kind: "agent", agentId: "child" } as const;
const targets = () => screen.getAllByTestId("panel").map((element) => element.dataset.target);
const visibleTarget = () => screen.getAllByTestId("panel").find(isShown)?.dataset.target;
// React Native Web hides retained panels through generated classes, not inline styles.
function isShown(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return false;
  }
  return true;
}
function panelFor(target: WorkspaceTabTarget) {
  const found = fake.panels.get(JSON.stringify(target));
  if (!found) throw new Error(`No panel for ${JSON.stringify(target)}`);
  return found;
}
// Upstream code that would open a workspace tab, such as a subagent row or the Changes pill.
function openInWorkspace(target: WorkspaceTabTarget) {
  let opened = false;
  act(() => {
    opened = openEmbeddedTarget(target);
  });
  return opened;
}

beforeEach(() => {
  fake.visible.mockClear();
  fake.prepare.mockClear();
  fake.openFile.mockClear();
  fake.panels.clear();
  vi.mocked(props.onSelectChat).mockClear();
  vi.mocked(navigateToWorkspace).mockClear();
});
afterEach(cleanup);

it("hands file links to the Vibing host instead of workspace navigation", () => {
  render(<NativeBotChat {...props} />);
  act(() =>
    panelFor(chat).openFileInWorkspace({
      location: { path: "/bot/src/app.ts", lineStart: 4 },
      disposition: "preferred",
    }),
  );
  expect(fake.openFile).toHaveBeenCalledWith(
    { kind: "file", path: "/bot/src/app.ts", lineStart: 4 },
    "/bot",
  );
  expect(targets()).toEqual([JSON.stringify(chat)]);
  expect(navigateToWorkspace).not.toHaveBeenCalled();
});

it("opens subagents inside the chat and returns to the retained parent", () => {
  render(<NativeBotChat {...props} />);
  openInWorkspace(provider);
  expect(visibleTarget()).toBe(JSON.stringify(provider));
  // The parent chat stays mounted, so its draft and scroll survive the detour.
  expect(targets()).toContain(JSON.stringify(chat));
  expect(screen.getByText("back from Explore task")).toBeTruthy();

  // Nested provider subagents open through the subagent pane and stack.
  const nested = { ...provider, subagentId: "nested" };
  act(() => panelFor(provider).openTab(nested));
  expect(visibleTarget()).toBe(JSON.stringify(nested));
  fireEvent.click(screen.getByText("back from Explore task"));
  expect(visibleTarget()).toBe(JSON.stringify(provider));
  fireEvent.click(screen.getByText("back from Explore task"));
  expect(visibleTarget()).toBe(JSON.stringify(chat));
  expect(props.onSelectChat).not.toHaveBeenCalled();
  expect(navigateToWorkspace).not.toHaveBeenCalled();
});

it("syncs a child agent's timeline while it is open, even from another workspace", () => {
  render(<NativeBotChat {...props} />);
  openInWorkspace(child);
  expect(visibleTarget()).toBe(JSON.stringify(child));
  expect(panelFor(child).workspaceId).toBe("other-workspace");
  expect(fake.prepare).toHaveBeenCalledWith("host", "child");
  expect(fake.visible).toHaveBeenLastCalledWith(expect.any(String), ["child"]);
  fireEvent.click(screen.getByText("back from Child agent"));
  expect(fake.visible).toHaveBeenLastCalledWith(expect.any(String), ["chat"]);
});

it("forgets open subagents when another chat is selected", () => {
  const view = render(<NativeBotChat {...props} />);
  openInWorkspace(provider);
  view.rerender(<NativeBotChat {...props} agentId="other" />);
  expect(targets()).toEqual([JSON.stringify({ kind: "agent", agentId: "other" })]);
});

it("shows Changes, plugin panels and other workspace views in the chat", () => {
  render(<NativeBotChat {...props} />);
  for (const target of [
    { kind: "changes_tree" },
    { kind: "working_diff", focusPath: "src/app.ts" },
    { kind: "files" },
    { kind: "plugin", pluginId: "paseo-doc-viewer", panelId: "documents", context: "workspace" },
  ] as WorkspaceTabTarget[]) {
    expect(openInWorkspace(target)).toBe(true);
    expect(visibleTarget()).toBe(JSON.stringify(target));
  }
  // Vibing supplies its own terminals, so those stay unhandled.
  expect(openInWorkspace({ kind: "terminal", terminalId: "t" })).toBe(false);
  // Opening the current chat closes the panels over it.
  expect(openInWorkspace(chat)).toBe(true);
  expect(visibleTarget()).toBe(JSON.stringify(chat));
});

it("keeps panel state such as a diff layout while the panel is open", () => {
  render(<NativeBotChat {...props} />);
  openInWorkspace({ kind: "working_diff" });
  act(() => panelFor({ kind: "working_diff" }).setCurrentTabState({ layout: "split" }));
  expect(panelFor({ kind: "working_diff" }).state).toEqual({ layout: "split" });
});

it("shows files outside the worktree in the chat's file panel", () => {
  render(<NativeBotChat {...props} />);
  act(() =>
    panelFor(chat).openFileInWorkspace({
      location: { path: "/outside/notes.md", lineStart: 2 },
      disposition: "preferred",
    }),
  );
  expect(fake.openFile).toHaveBeenCalledWith(
    { kind: "file", path: "/outside/notes.md", lineStart: 2 },
    "/bot",
  );
  expect(visibleTarget()).toBe(
    JSON.stringify({ kind: "file", path: "/outside/notes.md", lineStart: 2 }),
  );
});

it("only the visible chat receives workspace targets", () => {
  const view = render(<NativeBotChat {...props} active={false} />);
  expect(openInWorkspace(provider)).toBe(false);
  view.rerender(<NativeBotChat {...props} />);
  expect(openInWorkspace(provider)).toBe(true);
  view.unmount();
  expect(openInWorkspace(provider)).toBe(false);
});

it("keeps a closed diff mounted so its review comments stay attached", () => {
  render(<NativeBotChat {...props} />);
  const diff = { kind: "working_diff" } as const;
  openInWorkspace(diff);
  fireEvent.click(screen.getByText("back from working_diff"));
  expect(visibleTarget()).toBe(JSON.stringify(chat));
  // Hidden but still mounted, like a workspace's diff tab beside the chat.
  expect(targets()).toContain(JSON.stringify(diff));
  // Reopening (for example from the composer's review chip) shows the same panel.
  openInWorkspace({ ...diff, focusPath: "src/app.ts" });
  expect(visibleTarget()).toBe(JSON.stringify({ ...diff, focusPath: "src/app.ts" }));
  expect(targets().filter((target) => target?.includes("working_diff"))).toHaveLength(1);
});
