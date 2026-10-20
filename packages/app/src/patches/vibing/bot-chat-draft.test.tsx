// @vitest-environment jsdom
import React, { type ReactNode, type ComponentProps } from "react";
import type { Composer } from "@/composer";
import type { MessagePayload } from "@/composer/types";
import { act, render, screen, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { NativeBotChatDraft } from "./bot-chat-draft";

const mocks = vi.hoisted(() => ({
  submit: undefined as ((payload: MessagePayload) => Promise<void>) | undefined,
  encodeImages: vi.fn(),
  onStart: vi.fn(),
}));
vi.mock("@/composer", () => ({
  Composer: (props: ComponentProps<typeof Composer>) => {
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
    mocks.onStart.mockResolvedValue(undefined);
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
