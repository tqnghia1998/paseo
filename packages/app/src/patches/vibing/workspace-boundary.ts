import { useSessionStore } from "@/stores/session-store";
import { useSyncExternalStore } from "react";
import { parsePluginSurfaceRoute } from "@/plugins/routes";
import {
  parseHostWorkspaceRouteFromPathname,
  parseHostAgentRouteFromPathname,
} from "@/utils/host-routes";
import { isEmbeddedFocusMode } from "./focus-mode";
import { resolveEmbeddedToolEntryRoute } from "./embedded-tools";

interface Workspace {
  serverId: string;
  workspaceId: string;
  directory?: string;
  projectId?: string;
}
const APP_SECTIONS = new Set([
  "general",
  "appearance",
  "sidebar",
  "chat",
  "terminal",
  "editor",
  "shortcuts",
  "diagnostics",
  "about",
]);
const HOST_SECTIONS = new Set(["agents", "metadata", "providers", "usage", "terminals", "plugins"]);

// Each host iframe names its worktree. sessionStorage is shared by sibling frames,
// so a single last-workspace key would return Settings to the wrong worktree.
const storageKey =
  isEmbeddedFocusMode &&
  typeof window !== "undefined" &&
  typeof window.name === "string" &&
  window.name.startsWith("paseo-workspace:")
    ? `paseo:embedded-workspace:${window.name}`
    : null;

function readWorkspace(): Workspace | null {
  if (!isEmbeddedFocusMode || typeof window === "undefined") return null;
  if (new URLSearchParams(window.location.search).has("folder")) return null;
  try {
    const saved = storageKey ? JSON.parse(sessionStorage.getItem(storageKey) ?? "null") : null;
    if (typeof saved?.serverId === "string" && typeof saved?.workspaceId === "string") return saved;
  } catch {
    /* An in-memory binding still protects this frame when storage is unavailable. */
  }
  return parseHostWorkspaceRouteFromPathname(window.location.pathname);
}

let workspace = readWorkspace();
const workspaceListeners = new Set<() => void>();

function subscribeEmbeddedWorkspace(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => {
    workspaceListeners.delete(listener);
  };
}

export function getEmbeddedWorkspace(): Workspace | null {
  return workspace;
}

export function useEmbeddedWorkspace(): Workspace | null {
  return useSyncExternalStore(
    subscribeEmbeddedWorkspace,
    getEmbeddedWorkspace,
    getEmbeddedWorkspace,
  );
}

export function getEmbeddedWorkspaceDirectory(): string | undefined {
  if (!workspace) return undefined;
  return (
    workspace.directory ??
    useSessionStore.getState().sessions[workspace.serverId]?.workspaces?.get(workspace.workspaceId)
      ?.workspaceDirectory
  );
}

export function bindEmbeddedWorkspace(selection: Workspace): void {
  if (!isEmbeddedFocusMode || workspace) return;
  workspace = selection;
  try {
    if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(selection));
  } catch {
    /* Keep the in-memory binding. */
  }
  workspaceListeners.forEach((listener) => listener());
}

export function embeddedWorkspaceRoute(): string | null {
  return workspace ? resolveEmbeddedToolEntryRoute(workspace.serverId) : null;
}

export function isEmbeddedHostSectionAllowed(section: string): boolean {
  return !isEmbeddedFocusMode || HOST_SECTIONS.has(section);
}

export function isEmbeddedRouteAllowed(path: string): boolean {
  if (!isEmbeddedFocusMode) return true;
  const pathname = path.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  if (!workspace) return pathname === "/" || /^\/h\/[^/]+$/.test(pathname);
  const target = parseHostWorkspaceRouteFromPathname(pathname);
  if (target) return false;
  if (pathname === "/settings") return true;
  const plugin = parsePluginSurfaceRoute(pathname);
  if (plugin) return plugin.serverId === workspace.serverId;
  const agent = parseHostAgentRouteFromPathname(pathname);
  if (agent) return false;
  return isEmbeddedSettingsRouteAllowed(pathname, workspace);
}

function isEmbeddedSettingsRouteAllowed(pathname: string, bound: Workspace): boolean {
  const segments = pathname
    .split("/")
    .slice(1)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  if (segments[0] !== "settings") return false;
  if (segments.length === 2) return APP_SECTIONS.has(segments[1]);
  if (segments[1] !== "hosts" || segments[2] !== bound.serverId) return false;
  if (segments.length === 5 && segments[3] === "projects") {
    const projectId =
      bound.projectId ??
      useSessionStore.getState().sessions[bound.serverId]?.workspaces?.get(bound.workspaceId)
        ?.projectId;
    return Boolean(projectId && segments[4] === projectId);
  }
  return (
    (segments.length === 4 && HOST_SECTIONS.has(segments[3])) ||
    (segments.length === 6 && segments[3] === "plugins")
  );
}

export function isEmbeddedWorkspaceAllowed(
  serverId: string,
  workspaceId: string | null | undefined,
): boolean {
  if (!isEmbeddedFocusMode) return true;
  if (!workspace || workspace.serverId !== serverId || !workspaceId) return false;
  if (workspace.workspaceId === workspaceId) return true;
  const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
  const directory = getEmbeddedWorkspaceDirectory();
  return Boolean(directory && workspaces?.get(workspaceId)?.workspaceDirectory === directory);
}
