import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { openFolderWorkspace } from "./folder-workspace";

const existingWorkspace: WorkspaceDescriptor = {
  id: "workspace-existing",
  projectId: "project-1",
  projectDisplayName: "Repo",
  projectRootPath: "/workspace/repo",
  workspaceDirectory: "/workspace/repo-worktrees/feature-test",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "feature-test",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  diffStat: null,
  scripts: [],
};

describe("openFolderWorkspace", () => {
  it("uses the daemon's idempotent open-project path when the browser cache has not hydrated", async () => {
    const openProject = vi.fn().mockResolvedValue({
      workspace: existingWorkspace,
      error: null,
    });

    await expect(
      openFolderWorkspace({
        sessions: {},
        serverId: "server-1",
        folderPath: "/workspace/repo-worktrees/feature-test",
        client: { openProject },
      }),
    ).resolves.toMatchObject({ id: "workspace-existing" });

    expect(openProject).toHaveBeenCalledWith("/workspace/repo-worktrees/feature-test");
  });

  it("reuses an already hydrated workspace without another daemon request", async () => {
    const openProject = vi.fn();

    await expect(
      openFolderWorkspace({
        sessions: {
          "server-1": {
            workspaces: new Map([[existingWorkspace.id, existingWorkspace]]),
          },
        },
        serverId: "server-1",
        folderPath: "/workspace/repo-worktrees/feature-test/",
        client: { openProject },
      }),
    ).resolves.toBe(existingWorkspace);

    expect(openProject).not.toHaveBeenCalled();
  });
});
