// @vitest-environment jsdom
import React, { type ReactNode, type ComponentProps } from "react";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { Composer } from "@/composer";
import type { MessagePayload } from "@/composer/types";
import type { ImportSessionSheet } from "@/components/import-session-sheet";
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { NativeBotChatDraft } from "./bot-chat-draft";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";

const mocks = vi.hoisted(() => ({
  selection: {
    selectedProvider: "codex" as AgentProvider | null,
    effectiveModelId: "model",
    effectiveModeId: "full-access",
    effectiveThinkingOptionId: "high",
    isModelLoading: false,
    modelError: null as string | null,
    featureValues: { planMode: true },
    agentControls: {},
    commandDraft: {},
  },
  composer: null as ComponentProps<typeof Composer> | null,
  submit: undefined as ((payload: MessagePayload) => Promise<void>) | undefined,
  encodeImages: vi.fn(),
  onStart: vi.fn(),
  handoff: vi.fn(),
  importSheet: null as ComponentProps<typeof ImportSessionSheet> | null,
}));
vi.mock("@/composer/submission/writer", () => ({
  handoffCreatedAgentMessageSubmission: mocks.handoff,
}));
vi.mock("@/composer", async () => {
  const { useWorkspaceAttachmentsForScopes } =
    await import("@/attachments/workspace-attachments-store");
  return {
    Composer: (props: ComponentProps<typeof Composer>) => {
      mocks.composer = props;
      const context = useWorkspaceAttachmentsForScopes(props.attachmentScopeKeys);
      mocks.submit = (payload) =>
        props.onSubmitMessage!({
          ...payload,
          attachments: [...payload.attachments, ...context],
        });
      return <div data-testid="native-composer" />;
    },
  };
});
vi.mock("@/plugins", () => ({
  useHasPluginComposerPills: () => true,
  PluginComposerPills: ({ agentId }: { agentId: string }) => (
    <div data-testid="draft-prompts">{agentId}</div>
  ),
}));
vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => false }));
vi.mock("@/composer/dock", () => ({
  ComposerDock: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/composer/editing-session", () => ({
  useComposerEditingSession: () => ({}),
  useComposerFullscreen: () => false,
}));
vi.mock("@/components/file-drop/file-drop-zone", () => ({
  FileDropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/composer/draft/input-draft", () => ({
  useAgentInputDraft: () => ({
    composerState: mocks.selection,
    textSource: {},
    editText: vi.fn(),
    textReplacement: {},
    attachments: [],
    setAttachments: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("@/composer/draft/import-pill", () => ({
  ComposerImportPill: ({ onPress }: { onPress(): void }) => (
    <button type="button" onClick={onPress}>
      Import session
    </button>
  ),
}));
vi.mock("@/components/import-session-sheet", () => ({
  ImportSessionSheet: (props: ComponentProps<typeof ImportSessionSheet>) => {
    mocks.importSheet = props;
    return null;
  },
}));
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({}),
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("@/utils/encode-images", () => ({ encodeImages: mocks.encodeImages }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: Object.assign(() => null, {
    getState: () => ({ sessions: {} }),
  }),
}));

beforeEach(() => {
  mocks.selection.selectedProvider = "codex";
  mocks.selection.effectiveModelId = "model";
  mocks.selection.effectiveModeId = "full-access";
  mocks.selection.effectiveThinkingOptionId = "high";
  mocks.selection.isModelLoading = false;
  mocks.selection.modelError = null;
});

afterEach(() => {
  cleanup();
  useCreateFlowStore.getState().clearAll();
  useWorkspaceAttachmentsStore.setState({ attachmentsByScope: {} });
});

describe("native bot draft", () => {
  it("uses the native composer and forwards text, files and encoded images through bot creation", async () => {
    const images = [{ data: "encoded", mimeType: "image/png" }];
    mocks.encodeImages.mockResolvedValue(images);
    mocks.onStart.mockResolvedValue("created");
    render(
      <NativeBotChatDraft
        active
        serverId="host"
        botId="bot"
        cwd="/bot"
        provider="codex"
        model="model"
        onStart={mocks.onStart}
      />,
    );
    expect(screen.getByTestId("native-composer")).toBeTruthy();
    const file = {
      type: "text",
      text: "context",
      title: "Notes",
      mimeType: "text/plain",
    } as const;
    await act(async () =>
      mocks.submit!({
        text: "Review this",
        cwd: "/bot",
        attachments: [{ kind: "text", attachment: file }],
      }),
    );
    expect(mocks.handoff).toHaveBeenCalledWith(
      "host",
      "created",
      expect.objectContaining({ text: "Review this", attachments: [file] }),
    );
    expect(mocks.onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Review this",
        images,
        attachments: [file],
        messageId: expect.any(String),
      }),
    );
  });

  it("does not create a bot chat if an image cannot be encoded", async () => {
    mocks.onStart.mockClear();
    mocks.encodeImages.mockResolvedValue([]);
    render(
      <NativeBotChatDraft
        active
        serverId="host"
        botId="bot"
        cwd="/bot"
        provider="codex"
        model="model"
        onStart={mocks.onStart}
      />,
    );
    await expect(
      mocks.submit!({
        text: "Image",
        cwd: "/bot",
        attachments: [
          {
            kind: "image",
            metadata: {
              id: "image",
              mimeType: "image/png",
              storageType: "web-indexeddb",
              storageKey: "image",
              createdAt: 0,
            },
          },
        ],
      }),
    ).rejects.toThrow("encode");
    expect(mocks.onStart).not.toHaveBeenCalled();
  });
});

it("scopes native drafts to their workspace and resolves the created agent for Live Design", async () => {
  mocks.encodeImages.mockResolvedValue([]);
  mocks.onStart.mockResolvedValue("created-bot-agent");
  const props = {
    active: true,
    serverId: "host",
    botId: "bot",
    cwd: "/one",
    workspaceId: "one",
    provider: "codex" as const,
    onStart: mocks.onStart,
  };
  const view = render(<NativeBotChatDraft {...props} />);
  const first = mocks.composer!.agentId;
  expect(mocks.composer!.workspaceId).toBe("one");
  expect(screen.getByTestId("draft-prompts").textContent).toBe(first);
  await act(async () => mocks.submit!({ text: "Review", cwd: "/one", attachments: [] }));
  expect(mocks.composer!.resolveLiveDesignAgentId!()).toBe("created-bot-agent");
  view.rerender(<NativeBotChatDraft {...props} cwd="/two" workspaceId="two" />);
  expect(mocks.composer!.agentId).not.toBe(first);
  expect(screen.getByTestId("draft-prompts").textContent).toBe(mocks.composer!.agentId);
});

it("submits only this fork draft's history to the new bot chat", async () => {
  const history = {
    type: "text",
    title: "Chat history",
    mimeType: "text/plain",
    text: "Earlier conversation",
  } as const;
  const store = useWorkspaceAttachmentsStore.getState();
  for (const draftId of ["fork", "other-fork"]) {
    store.setWorkspaceAttachments({
      scopeKey: buildDraftWorkspaceAttachmentScopeKey(draftId),
      attachments: [
        {
          kind: "chat_history",
          id: draftId,
          attachment: {
            ...history,
            text: draftId === "fork" ? history.text : "Other conversation",
          },
          source: { serverId: "host", agentId: "source" },
        },
      ],
    });
  }
  mocks.encodeImages.mockResolvedValue([]);
  const start = vi.fn().mockResolvedValue("new-chat");
  render(
    <NativeBotChatDraft
      serverId="host"
      botId="bot"
      draftId="fork"
      cwd="/worktree"
      workspaceId="workspace"
      provider="codex"
      active
      onStart={start}
    />,
  );
  await act(async () => mocks.submit!({ text: "Continue", cwd: "/worktree", attachments: [] }));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ text: "Continue", attachments: [history] }),
  );
});

const BOT_LABELS = { "paseo-bots.bot": "bot" };

it("imports sessions into the bot within its worktree", () => {
  mocks.importSheet = null;
  const onImported = vi.fn();
  const props = {
    active: true,
    serverId: "host",
    botId: "bot",
    cwd: "/worktree",
    provider: "codex" as const,
    onStart: mocks.onStart,
  };
  const view = render(<NativeBotChatDraft {...props} workspaceId="workspace" />);
  expect(screen.queryByText("Import session")).toBeNull();
  view.rerender(
    <NativeBotChatDraft
      {...props}
      workspaceId="workspace"
      importLabels={BOT_LABELS}
      onImported={onImported}
    />,
  );
  expect(mocks.importSheet!.visible).toBe(false);
  fireEvent.click(screen.getByText("Import session"));
  expect(mocks.importSheet).toMatchObject({
    visible: true,
    cwd: "/worktree",
    workspaceId: "workspace",
    labels: { "paseo-bots.bot": "bot" },
    scopeLocked: true,
  });
  mocks.importSheet!.onImportedAgent!("imported");
  expect(onImported).toHaveBeenCalledWith("imported");
});

it("focuses the new chat composer while its pane is active and idle", async () => {
  let finishStart: (id: string) => void = () => {};
  const start = vi.fn(() => new Promise<string>((resolve) => (finishStart = resolve)));
  mocks.encodeImages.mockResolvedValue([]);
  const props = {
    serverId: "host",
    botId: "bot",
    cwd: "/worktree",
    workspaceId: "workspace",
    provider: "codex" as const,
    onStart: start,
  };
  const view = render(<NativeBotChatDraft {...props} active={false} />);
  expect(mocks.composer!.autoFocus).toBe(false);
  view.rerender(<NativeBotChatDraft {...props} active />);
  expect(mocks.composer!.autoFocus).toBe(true);
  let sent: Promise<unknown> = Promise.resolve();
  act(() => {
    sent = mocks.submit!({ text: "Hi", cwd: "/worktree", attachments: [] });
  });
  await waitFor(() => expect(mocks.composer!.autoFocus).toBe(false));
  await act(async () => {
    finishStart("created");
    await sent;
  });
  view.rerender(<NativeBotChatDraft {...props} active draftId="next-draft" />);
  expect(mocks.composer!.autoFocus).toBe(true);
});

it("keeps one creation in flight across draft remounts and retries a failed request", async () => {
  let rejectStart: (reason: Error) => void = () => {};
  const start = vi.fn(
    () =>
      new Promise<string>((_resolve, reject) => {
        rejectStart = reject;
      }),
  );
  mocks.encodeImages.mockResolvedValue([]);
  const props = {
    active: true,
    serverId: "host",
    botId: "bot",
    draftId: "retry",
    cwd: "/worktree",
    provider: "codex" as const,
    onStart: start,
  };
  let view = render(<NativeBotChatDraft {...props} />);
  let first: Promise<void> = Promise.resolve();
  act(() => {
    first = mocks.submit!({
      text: "Review",
      cwd: "/worktree",
      attachments: [],
    });
  });
  const failed = expect(first).rejects.toThrow("Try again");
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  view.unmount();
  view = render(<NativeBotChatDraft {...props} />);
  await act(async () => {
    await expect(
      mocks.submit!({ text: "Duplicate", cwd: "/worktree", attachments: [] }),
    ).rejects.toThrow();
    rejectStart(new Error("Try again"));
    await failed;
  });
  expect(start).toHaveBeenCalledTimes(1);
  start.mockImplementation(async () => "retried-chat");
  await act(async () => {
    await mocks.submit!({
      text: "Review again",
      cwd: "/worktree",
      attachments: [],
    });
  });
  expect(start).toHaveBeenCalledTimes(2);
  expect(mocks.handoff).toHaveBeenLastCalledWith(
    "host",
    "retried-chat",
    expect.objectContaining({ text: "Review again" }),
  );
});

it("starts with the draft's selected runtime instead of the bot defaults", async () => {
  mocks.selection.selectedProvider = "claude";
  mocks.selection.effectiveModelId = "opus";
  mocks.selection.effectiveModeId = "default";
  mocks.selection.effectiveThinkingOptionId = "medium";
  mocks.encodeImages.mockResolvedValue([]);
  const start = vi.fn().mockResolvedValue("claude-chat");
  render(
    <NativeBotChatDraft
      serverId="host"
      botId="review-lead"
      cwd="/worktree"
      provider="codex"
      model="codex-default"
      active
      onStart={start}
    />,
  );
  expect(mocks.composer!.agentControls!.disabled).toBe(false);
  await act(async () => mocks.submit!({ text: "Review", cwd: "/worktree", attachments: [] }));
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      agentSettings: {
        provider: "claude",
        model: "opus",
        modeId: "default",
        thinkingOptionId: "medium",
        featureValues: { planMode: true },
      },
    }),
  );
});

it.each(["loading", "missing provider", "missing model", "catalog error"])(
  "does not silently start with bot defaults when the selection is %s",
  async (state) => {
    if (state === "loading") mocks.selection.isModelLoading = true;
    if (state === "missing provider") mocks.selection.selectedProvider = null;
    if (state === "missing model") mocks.selection.effectiveModelId = "";
    if (state === "catalog error") mocks.selection.modelError = "Could not load models";
    const start = vi.fn();
    render(
      <NativeBotChatDraft
        serverId="host"
        botId="bot"
        cwd="/worktree"
        provider="codex"
        active
        onStart={start}
      />,
    );
    await act(async () => {
      await expect(
        mocks.submit!({ text: "Review", cwd: "/worktree", attachments: [] }),
      ).rejects.toThrow();
    });
    expect(start).not.toHaveBeenCalled();
  },
);

it("locks controls during creation and snapshots the selected runtime before image encoding", async () => {
  let finishEncoding: (images: { data: string; mimeType: string }[]) => void = () => {};
  mocks.encodeImages.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishEncoding = resolve;
      }),
  );
  const start = vi.fn().mockResolvedValue("chat");
  render(
    <NativeBotChatDraft
      serverId="host"
      botId="bot"
      cwd="/worktree"
      provider="codex"
      active
      onStart={start}
    />,
  );
  let sent: Promise<void> = Promise.resolve();
  act(() => {
    sent = mocks.submit!({ text: "Review", cwd: "/worktree", attachments: [] });
  });
  await waitFor(() => expect(mocks.composer!.agentControls!.disabled).toBe(true));
  mocks.selection.selectedProvider = "claude";
  mocks.selection.effectiveModelId = "opus";
  await act(async () => {
    finishEncoding([]);
    await sent;
  });
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({
      agentSettings: expect.objectContaining({ provider: "codex", model: "model" }),
    }),
  );
});
