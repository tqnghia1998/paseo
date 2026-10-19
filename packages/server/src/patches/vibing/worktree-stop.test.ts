import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorktreeStop } from "./worktree-runtime.js";

function setup() {
  const agents = [
    { id: "a", cwd: "/repo/one" },
    { id: "b", cwd: "/repo/one-other" },
  ];
  const terminals = [
    { id: "t1", workspaceId: "one" },
    { id: "t2", workspaceId: "other" },
  ];
  const services = {
    agentManager: {
      listAgents: () => agents,
      closeAgent: vi.fn(async () => {}),
      flush: vi.fn(async () => {}),
    },
    workspaceRegistry: {
      list: async () => [
        {
          workspaceId: "one",
          cwd: "/repo/one",
          worktreeRoot: null as string | null,
          archivedAt: null,
        },
        {
          workspaceId: "other",
          cwd: "/repo/one-other",
          worktreeRoot: null as string | null,
          archivedAt: null,
        },
      ],
    },
    terminalManager: {
      listDirectories: () => ["/repo/one"],
      getTerminals: async () => terminals,
      killTerminalAndWait: vi.fn(async () => {}),
    },
    stopWorkspaceSetup: vi.fn(async () => {}),
  };
  return { services, stop: createWorktreeStop(services) };
}

describe("worktree stop", () => {
  it("matches canonical worktree roots reached through a parent symlink", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-stop-alias-"));
    try {
      const real = path.join(root, "real");
      const alias = path.join(root, "alias");
      mkdirSync(real);
      symlinkSync(real, alias, process.platform === "win32" ? "junction" : "dir");
      const { services, stop } = setup();
      services.workspaceRegistry.list = async () => [
        { workspaceId: "one", cwd: alias, worktreeRoot: real, archivedAt: null },
      ];
      await stop([alias]);
      expect(services.stopWorkspaceSetup).toHaveBeenCalledExactlyOnceWith("one");
      expect(services.terminalManager.killTerminalAndWait).toHaveBeenCalledExactlyOnceWith("t1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("stops only owned resources and retains workspace/agent persistence", async () => {
    const { services, stop } = setup();
    await stop(["/repo/one"]);
    expect(services.stopWorkspaceSetup).toHaveBeenCalledExactlyOnceWith("one");
    expect(services.agentManager.closeAgent).toHaveBeenCalledExactlyOnceWith("a");
    expect(services.terminalManager.killTerminalAndWait).toHaveBeenCalledExactlyOnceWith("t1");
    expect(services.agentManager.flush).toHaveBeenCalledOnce();
  });
  it("reports a failed stop after attempting other resources", async () => {
    const { services, stop } = setup();
    services.agentManager.closeAgent.mockRejectedValue(new Error("still running"));
    await expect(stop(["/repo/one"])).rejects.toThrow("still running");
    expect(services.terminalManager.killTerminalAndWait).toHaveBeenCalledWith("t1");
    expect(services.agentManager.flush).toHaveBeenCalledOnce();
  });
});
