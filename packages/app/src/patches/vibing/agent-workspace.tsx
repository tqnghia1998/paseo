import { useLayoutEffect, type ReactNode } from "react";
import {
  collectAllPanes,
  collectAllTabs,
  findPaneById,
  type SplitNode,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { isEmbeddedFocusMode } from "./focus-mode";

export function StandaloneWorkspaceTools({ children }: { children: ReactNode }) {
  return isEmbeddedFocusMode ? null : children;
}

function conversationNode(node: SplitNode): SplitNode | null {
  if (node.kind === "pane") {
    if (node.pane.hidden === true) return null;
    const tabs = collectAllTabs(node).filter((tab) =>
      ["agent", "draft", "provider_subagent"].includes(tab.target.kind),
    );
    if (!tabs.length) return null;
    const focusedTabId = tabs.some((tab) => tab.tabId === node.pane.focusedTabId)
      ? node.pane.focusedTabId
      : tabs[0]!.tabId;
    const pane = { ...node.pane, tabs, tabIds: tabs.map((tab) => tab.tabId), focusedTabId };
    return { kind: "pane", pane };
  }
  const retained = node.group.children.flatMap((child, index) => {
    const projected = conversationNode(child);
    return projected ? [{ node: projected, size: node.group.sizes[index] ?? 1 }] : [];
  });
  if (!retained.length) return null;
  if (retained.length === 1) return retained[0]!.node;
  const total = retained.reduce((sum, child) => sum + child.size, 0);
  return {
    kind: "group",
    group: {
      ...node.group,
      children: retained.map((child) => child.node),
      sizes: retained.map((child) => (total > 0 ? child.size / total : 1 / retained.length)),
    },
  };
}

export function useEmbeddedAgentFocus(input: {
  enabled: boolean;
  workspaceKey: string | null;
  saved: WorkspaceLayout | null;
  visible: WorkspaceLayout | null;
  focusTab: (workspaceKey: string, tabId: string) => void;
}) {
  const { enabled, workspaceKey, saved, visible, focusTab } = input;
  useLayoutEffect(() => {
    if (!isEmbeddedFocusMode || !enabled || !workspaceKey || !saved || !visible) return;
    const selected = saved.focusedPaneId
      ? findPaneById(saved.root, saved.focusedPaneId)?.focusedTabId
      : null;
    const target = visible.focusedPaneId
      ? findPaneById(visible.root, visible.focusedPaneId)?.focusedTabId
      : null;
    if (target && target !== selected) focusTab(workspaceKey, target);
  }, [enabled, workspaceKey, saved, visible, focusTab]);
}

// Project the view only: saved tool tabs, unsaved editor state and live processes remain owned
// by the native layout/runtime rather than being deleted as a side effect of simplifying the UI.
export function projectEmbeddedAgentLayout(layout: WorkspaceLayout | null): WorkspaceLayout | null {
  if (!isEmbeddedFocusMode || !layout) return layout;
  const root = conversationNode(layout.root);
  if (!root) return null;
  const panes = collectAllPanes(root);
  return {
    ...layout,
    root,
    focusedPaneId: panes.some((pane) => pane.id === layout.focusedPaneId)
      ? layout.focusedPaneId
      : panes[0]!.id,
  };
}
