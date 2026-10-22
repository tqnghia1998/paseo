import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { getEmbeddedHostOrigin } from "./host-messages";

// The embedded build has no workspace file viewer; Vibing opens links in its VS Code tab.
export const HOST_OPEN_FILE = "paseo:open-file";

/** The link's path relative to the bound worktree, or null when it points outside it. */
export function worktreeRelativePath(path: string, workspaceRoot: string): string | null {
  const root = workspaceRoot.replace(/\/+$/, "");
  let relative = path;
  if (path.startsWith("/")) {
    if (!root || !path.startsWith(`${root}/`)) return null;
    relative = path.slice(root.length + 1);
  }
  relative = relative.replace(/^(?:\.\/)+/, "");
  if (!relative || relative.split("/").includes("..")) return null;
  return relative;
}

/** Asks the embedding host to open a worktree file; false when no host can open it. */
export function openFileInHost(location: WorkspaceFileLocation, workspaceRoot: string): boolean {
  const origin = getEmbeddedHostOrigin();
  const path = origin ? worktreeRelativePath(location.path, workspaceRoot) : null;
  if (!origin || !path) return false;
  const line = location.lineStart && location.lineStart > 0 ? location.lineStart : 1;
  window.parent.postMessage({ type: HOST_OPEN_FILE, path, line }, origin);
  return true;
}
