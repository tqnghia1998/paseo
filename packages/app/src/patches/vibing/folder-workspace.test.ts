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
        folderPath: "/workspace/repo-worktrees/feature-test",
        client: { openProject },
      }),
    ).resolves.toMatchObject({ id: "workspace-existing" });

    expect(openProject).toHaveBeenCalledWith("/workspace/repo-worktrees/feature-test");
  });

  it("resolves the current canonical workspace on every folder entry", async () => {
    const openProject = vi
      .fn()
      .mockResolvedValueOnce({ workspace: existingWorkspace, error: null })
      .mockResolvedValueOnce({
        workspace: { ...existingWorkspace, id: "workspace-canonical" },
        error: null,
      });

    await openFolderWorkspace({
      folderPath: "/workspace/repo-worktrees/feature-test/",
      client: { openProject },
    });

    await expect(
      openFolderWorkspace({
        folderPath: "/workspace/repo-worktrees/feature-test/",
        client: { openProject },
      }),
    ).resolves.toMatchObject({ id: "workspace-canonical" });

    expect(openProject).toHaveBeenCalledWith("/workspace/repo-worktrees/feature-test/");
    expect(openProject).toHaveBeenCalledTimes(2);
  });
});
