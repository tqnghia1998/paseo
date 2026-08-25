import { describe, expect, it } from "vitest";
import {
  createEmbeddedAgentActivityEvent,
  isEmbeddedAgentActivityRequest,
  isWorkspaceActivityRunning,
} from "./embedded-agent-activity";

describe("embedded agent activity", () => {
  it("uses canonical workspace activity and effective turn state", () => {
    expect(isWorkspaceActivityRunning(undefined, false)).toBe(false);
    expect(
      isWorkspaceActivityRunning({ agentId: "agent-1", status: "running", enteredAt: null }, false),
    ).toBe(true);
    expect(
      isWorkspaceActivityRunning({ agentId: "agent-1", status: "done", enteredAt: null }, true),
    ).toBe(true);
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
