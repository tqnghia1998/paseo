import { describe, expect, it, vi } from "vitest";
import {
  resolveEmbeddedActivityWorkspace,
  createEmbeddedAgentActivityEvent,
  isEmbeddedAgentActivityRequest,
  isEmbeddedWorkspaceRunning,
} from "./agent-activity";

vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => ({ serverId: "local", workspaceId: "bound" }),
}));

describe("embedded agent activity", () => {
  it("keeps observing the bound worktree while Settings is open or a foreign route is rejected", () => {
    expect(resolveEmbeddedActivityWorkspace("/settings/general")).toEqual({
      serverId: "local",
      workspaceId: "bound",
    });
    expect(resolveEmbeddedActivityWorkspace("/h/local/workspace/other")).toEqual({
      serverId: "local",
      workspaceId: "bound",
    });
  });
  it("keeps a workspace running when another conversation becomes idle", () => {
    const agents = [
      { id: "running", workspaceId: "workspace" },
      { id: "latest-idle", workspaceId: "workspace" },
      { id: "other", workspaceId: "different" },
      { id: "archived", workspaceId: "workspace", archivedAt: new Date() },
    ];
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", (id) => id === "running")).toBe(true);
    expect(
      isEmbeddedWorkspaceRunning(agents, "workspace", (id) => id === "other" || id === "archived"),
    ).toBe(false);
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", () => false)).toBe(false);
  });

  it("creates the host activity event contract", () => {
    expect(createEmbeddedAgentActivityEvent(true)).toEqual({
      type: "paseo:agent-activity",
      running: true,
    });
    expect(createEmbeddedAgentActivityEvent(false)).toEqual({
      type: "paseo:agent-activity",
      running: false,
    });
    expect(
      isEmbeddedAgentActivityRequest({
        type: "space:paseo-agent-activity-request",
      }),
    ).toBe(true);
    expect(isEmbeddedAgentActivityRequest({ type: "other" })).toBe(false);
  });
});
