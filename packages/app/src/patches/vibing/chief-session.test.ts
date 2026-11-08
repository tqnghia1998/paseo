import { describe, expect, it } from "vitest";
import {
  isChiefRequestId,
  isSameChiefIdentity,
  parseChiefSession,
  type ChiefSession,
} from "./chief-session";
import { CHIEF_POLICY_LABEL, verifyChiefAgent } from "./chief-verify";

const session: ChiefSession = {
  protocol: 1,
  status: "ready",
  policy: "chief-v1",
  serverId: "local",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  cwd: "/home/chief",
  provider: "claude",
};

describe("parseChiefSession", () => {
  it("accepts whichever provider Chief runs on", () => {
    for (const provider of ["codex", "claude", "opencode"])
      expect(parseChiefSession({ ...session, provider })?.provider).toBe(provider);
  });

  it("accepts the exact descriptor", () => {
    expect(parseChiefSession({ ...session })).toEqual(session);
  });

  it.each([
    ["protocol", 2],
    ["status", "starting"],
    ["policy", "chief-v2"],
    ["provider", ""],
    ["provider", 5],
    ["serverId", ""],
    ["agentId", "  "],
    ["workspaceId", 7],
    ["cwd", null],
  ])("rejects a bad %s", (key, value) => {
    expect(parseChiefSession({ ...session, [key]: value })).toBeNull();
  });

  it("rejects missing and extra keys, such as a leaked port or token", () => {
    const { cwd: _cwd, ...missing } = session;
    expect(parseChiefSession(missing)).toBeNull();
    expect(parseChiefSession({ ...session, port: 8251 })).toBeNull();
    expect(parseChiefSession({ ...session, token: "secret" })).toBeNull();
  });

  it.each([null, undefined, "x", 1, [], [session]])("rejects non-object %s", (value) => {
    expect(parseChiefSession(value)).toBeNull();
  });
});

describe("request ids and identity", () => {
  it("bounds request ids", () => {
    expect(isChiefRequestId("a")).toBe(true);
    expect(isChiefRequestId("")).toBe(false);
    expect(isChiefRequestId("a".repeat(129))).toBe(false);
    expect(isChiefRequestId(1)).toBe(false);
  });

  it("compares server, agent, workspace and cwd", () => {
    expect(isSameChiefIdentity(session, { ...session })).toBe(true);
    for (const key of ["serverId", "agentId", "workspaceId", "cwd"] as const) {
      expect(isSameChiefIdentity(session, { ...session, [key]: "other" })).toBe(false);
    }
  });
});

describe("verifyChiefAgent", () => {
  const agent = {
    id: "agent-1",
    provider: "claude" as const,
    cwd: "/home/chief",
    workspaceId: "workspace-1",
    labels: { [CHIEF_POLICY_LABEL]: "chief-v1" },
    archivedAt: null,
  };

  it("passes only when every fact matches", () => {
    expect(verifyChiefAgent(agent, session)).toBeNull();
  });

  it.each([
    ["not-found", null],
    ["agent-mismatch", { ...agent, id: "agent-2" }],
    ["workspace-mismatch", { ...agent, workspaceId: "workspace-2" }],
    ["workspace-mismatch", { ...agent, workspaceId: undefined }],
    ["cwd-mismatch", { ...agent, cwd: "/repo" }],
    ["provider-mismatch", { ...agent, provider: "codex" as const }],
    ["archived", { ...agent, archivedAt: "2026-11-06T00:00:00Z" }],
    ["policy-missing", { ...agent, labels: {} }],
    ["policy-missing", { ...agent, labels: { [CHIEF_POLICY_LABEL]: "other" } }],
  ])("fails with %s", (failure, value) => {
    expect(verifyChiefAgent(value, session)).toBe(failure);
  });
});
