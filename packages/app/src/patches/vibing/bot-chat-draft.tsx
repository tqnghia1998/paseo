import React, { useRef, useState, useMemo, useCallback, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Composer } from "@/composer";
import { ComposerDock } from "@/composer/dock";
import { useComposerEditingSession, useComposerFullscreen } from "@/composer/editing-session";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useDraftAgentCreateFlow } from "@/composer/draft/create-flow";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { encodeImages } from "@/utils/encode-images";
import type { MessagePayload } from "@/composer/types";
import type { NativeBotChatProps } from "./bot-chat-types";
import { useDraftWorkspaceAttachmentScopeKey } from "@/attachments/workspace-attachments-store";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import { COMPOSER_PILL_CLEARANCE } from "@/composer/pill-styles";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { shouldAutoFocusWorkspaceDraftComposer } from "@/screens/workspace/workspace-draft-pane-focus";

import { PluginComposerPills, useHasPluginComposerPills } from "@/plugins";
import { useIsCompactFormFactor } from "@/constants/layout";
import { botChatDraftId } from "./bot-chat-scope";

export function NativeBotChatDraft(props: Omit<NativeBotChatProps, "agentId" | "onSelectChat">) {
  const draftId = props.draftId ?? botChatDraftId(props.botId, props.workspaceId ?? props.cwd);
  return <BotChatDraft key={draftId} {...props} draftId={draftId} />;
}

function BotChatDraft(
  props: Omit<NativeBotChatProps, "agentId" | "onSelectChat"> & {
    draftId: string;
  },
) {
  const { serverId, cwd, onStart, importLabels, onImported, draftId } = props;
  const hasPluginPills = useHasPluginComposerPills(serverId, props.workspaceId ?? "", draftId);
  const compact = useIsCompactFormFactor();
  const draftAttachmentScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const attachmentScopeKeys = useMemo(() => [draftAttachmentScopeKey], [draftAttachmentScopeKey]);
  const createdAgentId = useRef<string | undefined>(undefined);
  const resolveAgentId = useCallback(() => createdAgentId.current, []);
  const input = useAgentInputDraft({
    draftKey: `draft:${serverId}:${draftId}`,
    composer: {
      initialServerId: serverId,
      initialValues: {
        provider: props.provider,
        model: props.model,
        modeId: props.modeId,
        thinkingOptionId: props.thinkingOptionId,
      },
      lockedWorkingDir: cwd,
      isVisible: props.active,
    },
  });
  const editingSession = useComposerEditingSession("chat");
  const fullscreen = useComposerFullscreen(editingSession);
  const flow = useDraftAgentCreateFlow({
    draftId,
    getPendingServerId: () => serverId,
    buildDraftAgent: () => null,
    createRequest: async ({ attempt, text, images = [], attachments = [] }) => {
      const encoded = await encodeImages(images);
      if (images.length && encoded?.length !== images.length)
        throw new Error("Could not encode every image attachment");
      const agentId = await onStart({
        text,
        messageId: attempt.clientMessageId,
        images: encoded ?? [],
        attachments,
      });
      createdAgentId.current = agentId;
      return { agentId, result: undefined };
    },
    onCreateSuccess: () => {},
  });
  const { handleCreateFromInput, isSubmitting: submitting } = flow;
  const submit = useCallback(
    (payload: MessagePayload) =>
      handleCreateFromInput({
        text: payload.text.trim() || "See the attached files.",
        attachments: payload.attachments,
        cwd,
      }),
    [handleCreateFromInput, cwd],
  );
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [importOpen, setImportOpen] = useState(false);
  const openImport = useCallback(() => setImportOpen(true), []);
  const closeImport = useCallback(() => setImportOpen(false), []);
  // Bot chats are scoped to the bound worktree, so imports stay there too.
  const canImport = Boolean(importLabels && onImported && props.workspaceId && cwd);
  const agentControls = useMemo(
    () =>
      input.composerState ? { ...input.composerState.agentControls, disabled: true } : undefined,
    [input.composerState],
  );
  return (
    <FileDropZone style={styles.container}>
      <ComposerDock fullscreen={fullscreen}>
        <View style={styles.container} />
        <View style={styles.inputArea}>
          {(canImport || hasPluginPills) && !submitting && !fullscreen ? (
            <View style={styles.importPillRow}>
              <DraftPillContent>
                {canImport ? (
                  <ComposerImportPill onPress={openImport} disabled={!connected} />
                ) : null}
                {props.workspaceId ? (
                  <PluginComposerPills
                    serverId={serverId}
                    workspaceId={props.workspaceId}
                    agentId={draftId}
                    compact={compact}
                  />
                ) : null}
              </DraftPillContent>
            </View>
          ) : null}
          <Composer
            agentId={draftId}
            workspaceId={props.workspaceId}
            resolveLiveDesignAgentId={resolveAgentId}
            serverId={serverId}
            isPaneFocused={props.active}
            autoFocus={shouldAutoFocusWorkspaceDraftComposer({
              isPaneFocused: props.active,
              isSubmitting: submitting,
            })}
            onSubmitMessage={submit}
            isSubmitLoading={submitting || !cwd}
            textSource={input.textSource}
            onChangeText={input.editText}
            textReplacement={input.textReplacement}
            attachments={input.attachments}
            attachmentScopeKeys={attachmentScopeKeys}
            onChangeAttachments={input.setAttachments}
            cwd={cwd}
            clearDraft={input.clear}
            editingSession={editingSession}
            commandDraft={input.composerState?.commandDraft}
            agentControls={agentControls}
          />
        </View>
      </ComposerDock>
      {canImport ? (
        <ImportSessionSheet
          visible={importOpen}
          client={client}
          serverId={serverId}
          cwd={cwd}
          workspaceId={props.workspaceId}
          labels={importLabels}
          scopeLocked
          onClose={closeImport}
          onImportedAgent={onImported}
        />
      ) : null}
    </FileDropZone>
  );
}

function DraftPillContentView({
  children,
  contentMaxWidth,
}: {
  children: ReactNode;
  contentMaxWidth: number;
}) {
  return <View style={[styles.importPillContent, { maxWidth: contentMaxWidth }]}>{children}</View>;
}

// Settings temporarily uses the ordinary chat width; subscribe when this retained draft returns.
const DraftPillContent = withUnistyles(DraftPillContentView, (theme) => ({
  contentMaxWidth: theme.contentMaxWidth,
}));

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  // Composer pads itself; extra inset here would shift it when the draft becomes a chat.
  inputArea: { width: "100%" },
  importPillRow: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingBottom: {
      xs: COMPOSER_PILL_CLEARANCE.compact,
      md: COMPOSER_PILL_CLEARANCE.wide,
    },
  },
  importPillContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
