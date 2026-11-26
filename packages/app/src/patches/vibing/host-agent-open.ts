import { router, type Href } from "expo-router";
import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { isEmbeddedFocusMode, isEmbeddedTasksView } from "./focus-mode";
import { getEmbeddedHostOrigin } from "./host-messages";
import { embeddedWorkspaceRoute } from "./workspace-boundary";

export const HOST_OPEN_AGENT = "paseo:open-agent";
export const HOST_TOGGLE_TASKS_BOARD = "paseo:toggle-tasks-board";

function isMacShortcutPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  if (platform) return /mac|ios/i.test(platform);
  return /Mac|iPhone|iPad/i.test(navigator.userAgent ?? "");
}

export function isToggleTasksBoardKeyEvent(
  event: Pick<
    KeyboardEvent,
    "code" | "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
  >,
  isMac = isMacShortcutPlatform(),
): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false;
  const modPressed = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modPressed) return false;
  return event.code === "KeyB" || event.key.toLowerCase() === "b";
}

/**
 * Hands an agent card click from an embedded plugin screen (such as Better Paseo's Tasks board)
 * to the embedding Space App Vibing host so it can switch to the owning feature worktree and open
 * the chat in Bots.
 */
export function openAgentInEmbeddedHost(input: { serverId: string; agentId: string }): boolean {
  if (!isEmbeddedFocusMode) return false;
  const origin = getEmbeddedHostOrigin();
  if (!origin) return false;

  const session = useSessionStore.getState().sessions[input.serverId];
  const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
  const workspace = agent?.workspaceId ? session?.workspaces?.get(agent.workspaceId) : undefined;
  const cwd = agent?.cwd ?? workspace?.workspaceDirectory ?? null;

  window.parent.postMessage(
    {
      type: HOST_OPEN_AGENT,
      agentId: input.agentId,
      cwd,
    },
    origin,
  );

  if (!isEmbeddedTasksView) {
    const route = embeddedWorkspaceRoute();
    if (route) router.replace(route as Href);
  }
  return true;
}

/**
 * Bridges Cmd/Ctrl+B from any embedded Paseo iframe to Space App Vibing's inline Bot Chats board
 * (before Better Paseo's in-frame listener opens a local screen).
 */
export function useEmbeddedTasksShortcuts(): void {
  useEffect(() => {
    if (!isEmbeddedFocusMode || typeof window === "undefined") return;
    const origin = getEmbeddedHostOrigin();
    if (!origin) return;

    const onCaptureKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isToggleTasksBoardKeyEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        window.parent.postMessage({ type: HOST_TOGGLE_TASKS_BOARD }, origin);
      }
    };

    window.addEventListener("keydown", onCaptureKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onCaptureKeyDown, true);
    };
  }, []);
}
