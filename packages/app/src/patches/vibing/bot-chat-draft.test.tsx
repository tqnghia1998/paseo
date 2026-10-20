// @vitest-environment jsdom
import React, { type ReactNode, type ComponentProps } from "react";
import type { Composer } from "@/composer";
import type { MessagePayload } from "@/composer/types";
import { act, render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { NativeBotChatDraft } from "./bot-chat-draft";

const mocks = vi.hoisted(() => ({
  composer: null as ComponentProps<typeof Composer> | null,
  submit: undefined as ((payload: MessagePayload) => Promise<void>) | undefined,
  encodeImages: vi.fn(),
  onStart: vi.fn(),
  handoff: vi.fn(),
}));
vi.mock("@/composer/submission/writer", () => ({
  handoffCreatedAgentMessageSubmission: mocks.handoff,
}));
vi.mock("@/composer", () => ({
  Composer: (props: ComponentProps<typeof Composer>) => {
    mocks.composer = props;
    mocks.submit = props.onSubmitMessage;
    return <div data-testid="native-composer" />;
  },
}));
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
    composerState: { agentControls: {}, commandDraft: {} },
    textSource: {},
    editText: vi.fn(),
    textReplacement: {},
    attachments: [],
    setAttachments: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("@/utils/encode-images", () => ({ encodeImages: mocks.encodeImages }));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: Object.assign(() => null, { getState: () => ({ sessions: {} }) }),
}));

afterEach(cleanup);

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
    const file = { type: "text", text: "context", title: "Notes", mimeType: "text/plain" } as const;
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
  await act(async () => mocks.submit!({ text: "Review", cwd: "/one", attachments: [] }));
  expect(mocks.composer!.resolveLiveDesignAgentId!()).toBe("created-bot-agent");
  view.rerender(<NativeBotChatDraft {...props} cwd="/two" workspaceId="two" />);
  expect(mocks.composer!.agentId).not.toBe(first);
});
