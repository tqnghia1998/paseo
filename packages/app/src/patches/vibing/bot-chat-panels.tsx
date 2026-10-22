import React, { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import { BackHeader } from "@/components/headers/back-header";
import { RetainedPanel } from "@/components/retained-panel";
import {
  PaneFocusProvider,
  PaneProvider,
  createPaneFocusContextValue,
  type PaneContextValue,
} from "@/panels/pane-context";
import { getPanelRegistration } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

// Vibing supplies terminals, the browser and setup itself; drafts are Bots chats.
type UnshownKind = "new_tab" | "draft" | "terminal" | "browser" | "setup";
export type BotChatPanelTarget = Exclude<WorkspaceTabTarget, { kind: UnshownKind }>;

const UNSHOWN_KINDS: ReadonlySet<WorkspaceTabTarget["kind"]> = new Set<UnshownKind>([
  "new_tab",
  "draft",
  "terminal",
  "browser",
  "setup",
]);

export function isBotChatPanelTarget(target: WorkspaceTabTarget): target is BotChatPanelTarget {
  return !UNSHOWN_KINDS.has(target.kind);
}

export interface BotChatPanelEntry {
  /** Stable per target, like a workspace tab id. */
  id: string;
  target: BotChatPanelTarget;
  state?: JsonValue;
}

interface PanelStack {
  chatKey: string | null;
  entries: BotChatPanelEntry[];
  /**
   * The diff closed with Back. A workspace keeps its diff tab mounted, and the diff publishes
   * review comments to the composer only while mounted, so Bots keeps it mounted but hidden.
   */
  retained: BotChatPanelEntry | null;
}

/**
 * Panels opened from one chat in place of workspace tabs (subagents, Changes, files, plugin
 * panels), innermost last. Selecting another chat clears them.
 */
export function useBotChatPanelStack(chatKey: string | null) {
  const [stack, setStack] = useState<PanelStack>({ chatKey, entries: [], retained: null });
  const current = stack.chatKey === chatKey ? stack : { chatKey, entries: [], retained: null };
  const update = useCallback(
    (change: (stack: PanelStack) => Omit<PanelStack, "chatKey">) => {
      setStack((previous) => ({
        chatKey,
        ...change(
          previous.chatKey === chatKey ? previous : { chatKey, entries: [], retained: null },
        ),
      }));
    },
    [chatKey],
  );
  const open = useCallback(
    (target: WorkspaceTabTarget) => {
      if (!isBotChatPanelTarget(target)) return false;
      const id = buildDeterministicWorkspaceTabId(target);
      update(({ entries, retained }) => {
        const top = entries.at(-1);
        // Reopening the top panel retargets it, e.g. a diff focusing another file.
        if (top?.id === id)
          return { entries: [...entries.slice(0, -1), { ...top, target }], retained };
        if (retained?.id === id)
          return { entries: [...entries, { ...retained, target }], retained: null };
        return { entries: [...entries, { id, target }], retained };
      });
      return true;
    },
    [update],
  );
  const back = useCallback(
    () =>
      update(({ entries, retained }) => {
        const top = entries.at(-1);
        return {
          entries: entries.slice(0, -1),
          retained: top?.target.kind === "working_diff" ? top : retained,
        };
      }),
    [update],
  );
  const close = useCallback(
    () =>
      update(({ entries, retained }) => ({
        entries: [],
        retained:
          entries.toReversed().find((entry) => entry.target.kind === "working_diff") ?? retained,
      })),
    [update],
  );
  const setEntryState = useCallback(
    (id: string, state: JsonValue) =>
      update(({ entries, retained }) => ({
        entries: entries.map((entry) => (entry.id === id ? { ...entry, state } : entry)),
        retained: retained?.id === id ? { ...retained, state } : retained,
      })),
    [update],
  );
  return {
    top: current.entries.at(-1) ?? null,
    retained: current.retained,
    open,
    back,
    close,
    setEntryState,
  };
}

export type BotChatPanelPane = PaneContextValue & { target: BotChatPanelTarget };

/**
 * The chat with the panel opened from it on top. The chat, and a diff closed with Back, stay
 * mounted underneath, keeping drafts, scroll position and review comments.
 */
export function BotChatPanelLayer({
  panes,
  active,
  onBack,
  testID,
  children,
}: {
  panes: ReadonlyArray<{ pane: BotChatPanelPane; visible: boolean }>;
  active: boolean;
  onBack(): void;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.container} testID={testID}>
      <RetainedPanel active={!panes.some(({ visible }) => visible)}>{children}</RetainedPanel>
      {panes.map(({ pane, visible }) => (
        <RetainedPanel key={pane.tabId} active={visible}>
          <BotChatPanelView pane={pane} active={active && visible} onBack={onBack} />
        </RetainedPanel>
      ))}
    </View>
  );
}

/** A panel as its workspace tab would show it, under a Back header. */
function BotChatPanelView({
  pane,
  active,
  onBack,
}: {
  pane: BotChatPanelPane;
  active: boolean;
  onBack(): void;
}) {
  ensurePanelsRegistered();
  const registration = getPanelRegistration(pane.target.kind);
  if (!registration) throw new Error(`No panel registration for kind: ${pane.target.kind}`);
  const descriptor = registration.useDescriptor(pane.target as never, {
    serverId: pane.serverId,
    workspaceId: pane.workspaceId,
    tabId: pane.tabId,
  });
  const focus = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: active, isPaneFocused: active }),
    [active],
  );
  const Panel = registration.component;
  return (
    <View style={styles.container} testID="bots-panel">
      <BackHeader title={descriptor.label} onBack={onBack} />
      <PaneProvider value={pane}>
        <PaneFocusProvider value={focus}>
          <Panel />
        </PaneFocusProvider>
      </PaneProvider>
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, minWidth: 0, minHeight: 0 } });
