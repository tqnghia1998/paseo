import { describe, expect, it } from "vitest";
import { createQueuedMessagePersistence, type QueuedMessageStorage } from "./queued-message-store";

function createStorage(): QueuedMessageStorage {
  const values = new Map<string, string>();
  return {
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
            ],
          },
        ],
      ],
    ]);

    await persistence.save("server-1", queued);

    expect(await persistence.load("server-1")).toEqual(queued);
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
      getItem: async () => "not json",
      setItem: async () => undefined,
      removeItem: async () => Promise.reject(new Error("storage unavailable")),
    };

    await expect(createQueuedMessagePersistence(storage).load("server-1")).resolves.toEqual(
      new Map(),
    );
  });
});
