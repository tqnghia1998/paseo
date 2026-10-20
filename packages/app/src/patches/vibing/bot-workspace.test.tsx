// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  activate: undefined as ((agentId?: string, newChat?: boolean) => string | void) | undefined,
  agents: new Map([
    ["existing", { cwd: "/worktree", labels: { "paseo-bots.bot": "reviewer" } }],
    ["foreign", { cwd: "/other", labels: {} }],
    ["legacy", { cwd: "/worktree", labels: {} }],
  ]),
}));
vi.mock("./workspace-boundary", () => ({
  useEmbeddedWorkspace: () => ({ serverId: "host", workspaceId: "workspace" }),
  getEmbeddedWorkspaceDirectory: () => "/worktree",
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: { host: { agents: fake.agents } } }) },
}));
vi.mock("./host-prompts", () => ({ useEmbeddedPromptActivation: () => {} }));
vi.mock("./live-design", () => ({
  useEmbeddedLiveDesignActivation: (input: { activateConversation: typeof fake.activate }) => {
    fake.activate = input.activateConversation;
  },
}));
import { BotWorkspaceBridge } from "./bot-workspace";
it("resumes the owning bot only in the bound worktree and routes legacy chats to General", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  fake.activate!("existing");
  expect(activate).toHaveBeenLastCalledWith({ botId: "reviewer", agentId: "existing" });
  fake.activate!("foreign");
  expect(activate).toHaveBeenCalledTimes(1);
  fake.activate!("legacy");
  expect(activate).toHaveBeenLastCalledWith({ botId: "vibing-general", agentId: "legacy" });
});
it("gives each fresh Live Design conversation a distinct composer for its handshake", () => {
  const activate = vi.fn();
  renderHook(() => BotWorkspaceBridge({ botId: "reviewer", onActivate: activate }));
  const first = fake.activate!(undefined, true);
  const second = fake.activate!(undefined, true);
  expect(first).toMatch(/^paseo-bots:reviewer:workspace:/);
  expect(second).not.toBe(first);
  expect(activate).toHaveBeenLastCalledWith({ draftId: second });
});

it("opens a workspace draft before accepting a host prompt from another folder's history", () => {
  const activate = vi.fn();
  renderHook(() =>
    BotWorkspaceBridge({ botId: "reviewer", selectedAgentId: "foreign", onActivate: activate }),
  );
  fake.activate!();
  expect(activate).toHaveBeenCalledWith({
    draftId: expect.stringMatching(/^paseo-bots:reviewer:workspace:/),
  });
});
