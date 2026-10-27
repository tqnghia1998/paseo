import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  createEmbeddedAgentActivityEvent,
  isEmbeddedAgentActivityRequest,
  isEmbeddedWorkspaceRunning,
} from "./agent-activity";

vi.mock("./workspace-boundary", () => ({
  getEmbeddedWorkspace: () => ({ serverId: "local", workspaceId: "bound" }),
}));

const surface = vi.hoisted(() => ({ liveDesign: false }));
vi.mock("./focus-mode", () => ({
  get isEmbeddedLiveDesignMessaging() {
    return surface.liveDesign;
  },
}));

beforeEach(() => {
  surface.liveDesign = false;
});

describe("embedded agent activity", () => {
  it.each([false, true])(
    "counts only the current conversation context (Live Design: %s)",
    (liveDesign) => {
      surface.liveDesign = liveDesign;
      const agents: Array<Pick<Agent, "id" | "workspaceId" | "archivedAt" | "labels">> = [
        { id: "legacy", workspaceId: "workspace", labels: {} },
        { id: "normal", workspaceId: "workspace", labels: { "paseo-bots.context": "workspace" } },
        { id: "design", workspaceId: "workspace", labels: { "paseo-bots.context": "live-design" } },
      ];
      for (const agent of agents) {
        expect(
          isEmbeddedWorkspaceRunning(agents, "workspace", (id) => id === agent.id),
          agent.id,
        ).toBe(liveDesign ? agent.id === "design" : agent.id !== "design");
      }
    },
  );

  it("clears Live Design activity when its last turn stops while a workspace bot keeps working", () => {
    surface.liveDesign = true;
    const agents: Array<Pick<Agent, "id" | "workspaceId" | "archivedAt" | "labels">> = [
      { id: "normal", workspaceId: "workspace", labels: {} },
      { id: "design", workspaceId: "workspace", labels: { "paseo-bots.context": "live-design" } },
    ];
    const active = new Set(["normal", "design"]);
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", (id) => active.has(id))).toBe(true);
    active.delete("design");
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", (id) => active.has(id))).toBe(false);
  });

  it("keeps a workspace running when another conversation becomes idle", () => {
    const agents: Array<Pick<Agent, "id" | "workspaceId" | "archivedAt" | "labels">> = [
      { id: "running", workspaceId: "workspace", labels: {} },
      { id: "latest-idle", workspaceId: "workspace", labels: {} },
      { id: "other", workspaceId: "different", labels: {} },
      { id: "archived", workspaceId: "workspace", archivedAt: new Date(), labels: {} },
    ];
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", (id) => id === "running")).toBe(true);
    expect(
      isEmbeddedWorkspaceRunning(agents, "workspace", (id) => id === "other" || id === "archived"),
    ).toBe(false);
    expect(isEmbeddedWorkspaceRunning(agents, "workspace", () => false)).toBe(false);
  });

  it("observes same-directory scheduled workspaces without including siblings", () => {
    const agents: Array<Pick<Agent, "id" | "workspaceId" | "archivedAt" | "labels">> = [
      { id: "scheduled", workspaceId: "run-one", labels: {} },
      { id: "sibling", workspaceId: "other", labels: {} },
    ];
    expect(
      isEmbeddedWorkspaceRunning(
        agents,
        "one",
        (id) => id === "scheduled",
        (id) => id === "one" || id === "run-one",
      ),
    ).toBe(true);
    expect(
      isEmbeddedWorkspaceRunning(
        agents,
        "one",
        (id) => id === "sibling",
        (id) => id === "one" || id === "run-one",
      ),
    ).toBe(false);
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
