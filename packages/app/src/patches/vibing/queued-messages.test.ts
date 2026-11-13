import { afterEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { queuedMessagePersistence } from "./queued-messages";
import { useDraftStore } from "@/stores/draft-store";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { encodeImages } from "@/utils/encode-images";
import { createLocalFileAttachmentStore } from "@/attachments/local-file-attachment-store";
import { createTestAttachmentFileSystem } from "@/attachments/test-attachment-file-system";
import { dispatchComposerAgentMessage } from "@/composer/actions";
import { createQueuedMessagePersistence, type QueuedMessageStorage } from "./queued-messages";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";

function createStorage(): QueuedMessageStorage {
  const values = new Map<string, string>();
  return {
    getAllKeys: async () => [...values.keys()],
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

describe("queued message persistence", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("collects saved image references across hosts and releases removed queues", async () => {
    const persistence = createQueuedMessagePersistence(createStorage());
    for (const serverId of ["server-1", "server-2"]) {
      await persistence.save(
        serverId,
        new Map([
          [
            "agent",
            [
              {
                id: serverId,
                text: "inspect image",
                attachments: [
                  {
                    kind: "image",
                    metadata: {
                      id: serverId,
                      storageKey: serverId,
                      storageType: "web-indexeddb",
                      mimeType: "image/png",
                      createdAt: 1,
                    },
                  },
                ],
              },
            ],
          ],
        ]),
      );
    }
    expect(await persistence.collectAttachmentIds()).toEqual(new Set(["server-1", "server-2"]));
    await persistence.save("server-1", new Map());
    expect(await persistence.collectAttachmentIds()).toEqual(new Set(["server-2"]));
  });

  it("waits for pending queue checkpoints before collecting image references", async () => {
    const storage = createStorage();
    let releaseWrite: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const persistence = createQueuedMessagePersistence({
      ...storage,
      setItem: async (key, value) => {
        await gate;
        await storage.setItem(key, value);
      },
    });
    const save = persistence.save(
      "server",
      new Map([
        [
          "agent",
          [
            {
              id: "queued",
              text: "inspect image",
              attachments: [
                {
                  kind: "image",
                  metadata: {
                    id: "image",
                    storageKey: "image",
                    storageType: "web-indexeddb",
                    mimeType: "image/png",
                    createdAt: 1,
                  },
                },
              ],
            },
          ],
        ],
      ]),
    );
    const collecting = persistence.collectAttachmentIds();
    releaseWrite();
    await save;
    expect(await collecting).toEqual(new Set(["image"]));
  });

  it("refuses to authorize image cleanup when a checkpoint cannot be read", async () => {
    const storage = createStorage();
    await storage.setItem("paseo-queued-messages:server", "not json");
    await expect(createQueuedMessagePersistence(storage).collectAttachmentIds()).rejects.toThrow();
    const unavailable = createQueuedMessagePersistence({
      ...storage,
      getAllKeys: async () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(unavailable.collectAttachmentIds()).rejects.toThrow("storage unavailable");
  });

  it("sends a saved queue's image after startup cleanup before its session restores", async () => {
    const fileSystem = createTestAttachmentFileSystem();
    const localStore = createLocalFileAttachmentStore({
      storageType: "native-file",
      baseDirectoryName: "queued-images",
      fileSystem,
      resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
    });
    let collections = 0;
    const store = {
      ...localStore,
      async garbageCollect(input: Parameters<typeof localStore.garbageCollect>[0]) {
        await localStore.garbageCollect(input);
        collections += 1;
      },
    };
    __setAttachmentStoreForTests(store);
    await AsyncStorage.clear();
    const metadata = await persistAttachmentFromBytes({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    await queuedMessagePersistence.save(
      "unrestored-server",
      new Map([
        [
          "agent",
          [
            {
              id: "queued",
              text: "inspect this image",
              attachments: [{ kind: "image", metadata }],
            },
          ],
        ],
      ]),
    );

    useDraftStore.getState().saveCreateModalDraft(null);
    await vi.waitFor(() => expect(collections).toBeGreaterThan(0));

    const restored = (await queuedMessagePersistence.load("unrestored-server")).get("agent")![0];
    const sendAgentMessage = vi.fn(async () => undefined);
    await dispatchComposerAgentMessage({
      client: { sendAgentMessage, uploadFile: vi.fn() },
      agentId: "agent",
      text: restored.text,
      attachments: restored.attachments,
      encodeImages,
      submission: { begin: vi.fn(), accept: vi.fn(), reject: vi.fn() },
    });
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent",
      "inspect this image",
      expect.objectContaining({
        images: [{ data: "AQID", mimeType: "image/png" }],
      }),
    );
  });

  it("restores queued text and supported attachments after an embedded host remount", async () => {
    const persistence = createQueuedMessagePersistence(createStorage());
    const queued = new Map([
      [
        "agent-1",
        [
          {
            id: "queued-1",
            text: "finish the tests",
            attachments: [
              {
                kind: "workspace_file" as const,
                path: "src/app.ts",
                selection: { kind: "whole_file" as const },
              },
              {
                kind: "text" as const,
                attachment: {
                  type: "text" as const,
                  mimeType: "text/plain" as const,
                  title: "Live Design context",
                  text: '[{"comment":"Tighten spacing"}]',
                },
              },
            ],
          },
        ],
      ],
    ]);

    await persistence.save("server-1", queued);

    expect(await persistence.load("server-1")).toEqual(queued);
    const restored = (await persistence.load("server-1")).get("agent-1")![0];
    expect(splitComposerAttachmentsForSubmit(restored.attachments).attachments[1]).toEqual(
      queued.get("agent-1")![0].attachments[1].attachment,
    );
  });

  it("keeps the most recent checkpoint when writes complete out of order", async () => {
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
    let firstWrite = true;
    const storage = createStorage();
    const persistence = createQueuedMessagePersistence({
      ...storage,
      setItem: async (key, value) => {
        if (firstWrite) {
          firstWrite = false;
          await firstWriteGate;
        }
        await storage.setItem(key, value);
      },
    });

    const firstSave = persistence.save(
      "server-1",
      new Map([["agent-1", [{ id: "old", text: "old", attachments: [] }]]]),
    );
    const secondSave = persistence.save(
      "server-1",
      new Map([["agent-1", [{ id: "new", text: "new", attachments: [] }]]]),
    );
    releaseFirstWrite();
    await Promise.all([firstSave, secondSave]);

    expect((await persistence.load("server-1")).get("agent-1")?.[0]?.id).toBe("new");
  });

  it("persists only user-owned attachments", async () => {
    const persistence = createQueuedMessagePersistence(createStorage());
    await persistence.save(
      "server-1",
      new Map([
        [
          "agent-1",
          [
            {
              id: "queued-1",
              text: "finish the tests",
              attachments: [
                {
                  kind: "review",
                  reviewDraftKey: "review-1",
                  commentCount: 1,
                  attachment: {
                    type: "review",
                    mimeType: "application/paseo-review",
                    cwd: "/repo",
                    mode: "uncommitted" as const,
                    comments: [],
                  },
                },
              ],
            },
          ],
        ],
      ]),
    );

    expect((await persistence.load("server-1")).get("agent-1")?.[0]?.attachments).toEqual([]);
  });

  it("drops a corrupt checkpoint instead of blocking a remounted session", async () => {
    const storage = createStorage();
    await storage.setItem("paseo-queued-messages:server-1", "not json");

    expect(await createQueuedMessagePersistence(storage).load("server-1")).toEqual(new Map());
    expect(await storage.getItem("paseo-queued-messages:server-1")).toBeNull();
  });

  it("keeps the in-memory queue usable when corrupt-checkpoint cleanup fails", async () => {
    const storage: QueuedMessageStorage = {
      getAllKeys: async () => [],
      getItem: async () => "not json",
      setItem: async () => undefined,
      removeItem: async () => Promise.reject(new Error("storage unavailable")),
    };

    await expect(createQueuedMessagePersistence(storage).load("server-1")).resolves.toEqual(
      new Map(),
    );
  });
});
