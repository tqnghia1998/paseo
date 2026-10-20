import React, { useRef, useState, useMemo, useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Composer } from "@/composer";
import { ComposerDock } from "@/composer/dock";
import { useComposerEditingSession, useComposerFullscreen } from "@/composer/editing-session";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import {
  splitComposerAttachmentsForSubmit,
  resolveComposerAttachmentSubmitFormat,
} from "@/composer/attachments/submit";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { encodeImages } from "@/utils/encode-images";
import { generateMessageId, createUserMessage } from "@/types/stream";
import { handoffCreatedAgentMessageSubmission } from "@/composer/submission/writer";
import { useSessionStore } from "@/stores/session-store";
import type { MessagePayload } from "@/composer/types";
import type { NativeBotChatProps } from "./bot-chat-types";

export function NativeBotChatDraft(props: Omit<NativeBotChatProps, "agentId" | "onSelectChat">) {
  const { serverId, botId, cwd, onStart } = props;
  const draftId = props.draftId ?? `paseo-bots:${botId}:${props.workspaceId ?? cwd}`;
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
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const messageId = useRef(generateMessageId());
  const submit = useCallback(
    async (payload: MessagePayload) => {
      if (submittingRef.current) throw new Error("Bot chat creation is already in progress");
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const supportsForgeAttachments =
          useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.forgeSearch === true;
        const wire = splitComposerAttachmentsForSubmit(payload.attachments, {
          format: resolveComposerAttachmentSubmitFormat({ supportsForgeAttachments }),
        });
        const images = await encodeImages(wire.images);
        if (wire.images.length && images?.length !== wire.images.length)
          throw new Error("Could not encode every image attachment");
        const timestamp = new Date();
        const text = payload.text.trim() || "See the attached files.";
        createdAgentId.current = await onStart({
          text,
          messageId: messageId.current,
          images: images ?? [],
          attachments: wire.attachments,
        });
        if (createdAgentId.current) {
          handoffCreatedAgentMessageSubmission(
            serverId,
            createdAgentId.current,
            createUserMessage({
              clientMessageId: messageId.current,
              text,
              timestamp,
              images: wire.images,
              attachments: wire.attachments,
            }),
          );
        }
        messageId.current = generateMessageId();
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [serverId, onStart],
  );
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
          <Composer
            agentId={draftId}
            workspaceId={props.workspaceId}
            resolveLiveDesignAgentId={resolveAgentId}
            serverId={serverId}
            isPaneFocused={props.active}
            onSubmitMessage={submit}
            isSubmitLoading={submitting || !cwd}
            textSource={input.textSource}
            onChangeText={input.editText}
            textReplacement={input.textReplacement}
            attachments={input.attachments}
            onChangeAttachments={input.setAttachments}
            cwd={cwd}
            clearDraft={input.clear}
            editingSession={editingSession}
            commandDraft={input.composerState?.commandDraft}
            agentControls={agentControls}
          />
        </View>
      </ComposerDock>
    </FileDropZone>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1 },
  inputArea: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[4] },
}));
