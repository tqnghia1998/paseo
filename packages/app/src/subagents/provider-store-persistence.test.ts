import { describe, expect, test, vi } from "vitest";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { TrackDismissalStorage } from "./track-dismissal-storage";
import { createProviderSubagentStore, providerSubagentKey } from "./provider-store";

const child: ProviderSubagentDescriptorPayload = {
  id: "child",
  parentAgentId: "parent",
  provider: "codex",
  title: "Finished child",
  description: null,
  status: "completed",
  toolCallId: "call",
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:01:00.000Z",
};

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getAllKeys: vi.fn(() => [...entries.keys()]),
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
  } satisfies TrackDismissalStorage;
}

async function openStore(storage: TrackDismissalStorage) {
  const store = createProviderSubagentStore(storage);
  await vi.waitFor(() => expect(store.persist.hasHydrated()).toBe(true));
  return store;
}

describe("provider subagent archive persistence", () => {
  test("keeps a finished child hidden after the client is recreated and history reloads", async () => {
    const storage = memoryStorage();
    const first = await openStore(storage);
    first.getState().replaceList("server", "parent", [child]);
    first.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));

    const reopened = await openStore(storage);
    expect(reopened.getState().descriptors.size).toBe(0);
    reopened.getState().replaceList("server", "parent", [child]);
    const key = providerSubagentKey("server", "parent", child.id);
    expect(reopened.getState().hiddenFromTrack.has(key)).toBe(true);
    expect(
      reopened.getState().hiddenFromTrack.has(providerSubagentKey("other", "parent", child.id)),
    ).toBe(false);
    expect(
      reopened.getState().hiddenFromTrack.has(providerSubagentKey("server", "other", child.id)),
    ).toBe(false);
    expect(reopened.getState().timelines.size).toBe(0);
  });

  test("persists revealing a child when it starts running again", async () => {
    const storage = memoryStorage();
    const first = await openStore(storage);
    first.getState().replaceList("server", "parent", [child]);
    first.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
    const reopened = await openStore(storage);
    reopened.getState().applyUpdate("server", {
      kind: "upsert",
      subagent: { ...child, status: "running" },
    });
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(0));
    const third = await openStore(storage);
    third.getState().replaceList("server", "parent", [child]);
    expect(third.getState().hiddenFromTrack.size).toBe(0);
  });

  test("does not rewrite dismissals for unchanged descriptor lists", async () => {
    const storage = memoryStorage();
    const store = await openStore(storage);
    store.getState().replaceList("server", "parent", [child]);
    store.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(1));
    storage.setItem.mockClear();
    store.getState().trackParent("server", "parent");
    store.getState().replaceList("server", "parent", [child]);
    await Promise.resolve();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  test("merges dismissals made during hydration and saves a resumed child's visibility", async () => {
    const storage = memoryStorage();
    const seed = await openStore(storage);
    seed.getState().replaceList("server", "parent", [child]);
    seed.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
    const stored = "1";
    let finishRead!: (value: string | null) => void;
    const reopening = createProviderSubagentStore({
      ...storage,
      getItem: () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
    });
    reopening.getState().applyUpdate("server", {
      kind: "upsert",
      subagent: { ...child, status: "running" },
    });
    const otherChild = { ...child, id: "other-child" };
    reopening.getState().applyUpdate("server", { kind: "upsert", subagent: otherChild });
    reopening.getState().hideFromTrack("server", "parent", [otherChild.id]);
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    finishRead(stored);
    await vi.waitFor(() => expect(reopening.persist.hasHydrated()).toBe(true));

    const third = await openStore(storage);
    expect([...third.getState().hiddenFromTrack]).toEqual([
      providerSubagentKey("server", "parent", otherChild.id),
    ]);
  });
  test("independent workspace frames preserve each other's dismissals", async () => {
    const storage = memoryStorage();
    const first = await openStore(storage);
    const second = await openStore(storage);
    first.getState().replaceList("server", "parent", [child]);
    first.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
    second
      .getState()
      .replaceList("server", "other-parent", [{ ...child, parentAgentId: "other-parent" }]);
    second.getState().hideFromTrack("server", "other-parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(2));
    const reopened = await openStore(storage);
    expect([...reopened.getState().hiddenFromTrack].sort()).toEqual(
      [
        providerSubagentKey("server", "parent", child.id),
        providerSubagentKey("server", "other-parent", child.id),
      ].sort(),
    );
  });
  test.each(["update", "list"])(
    "a running %s in another frame clears a dismissal it never loaded",
    async (source) => {
      const storage = memoryStorage();
      const first = await openStore(storage);
      const second = await openStore(storage);
      first.getState().replaceList("server", "parent", [child]);
      second.getState().replaceList("server", "parent", [child]);
      first.getState().hideFromTrack("server", "parent", [child.id]);
      await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
      const running = { ...child, status: "running" as const };
      if (source === "list") second.getState().replaceList("server", "parent", [running]);
      else second.getState().applyUpdate("server", { kind: "upsert", subagent: running });
      await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(0));
      const reopened = await openStore(storage);
      reopened.getState().replaceList("server", "parent", [child]);
      expect(reopened.getState().hiddenFromTrack.size).toBe(0);
    },
  );
  test("a new dismissal wins when a child resumes and finishes during hydration", async () => {
    const storage = memoryStorage();
    const seed = await openStore(storage);
    seed.getState().replaceList("server", "parent", [child]);
    seed.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
    let finishRead!: (value: string | null) => void;
    const reopening = createProviderSubagentStore({
      ...storage,
      getItem: () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
    });
    reopening
      .getState()
      .applyUpdate("server", { kind: "upsert", subagent: { ...child, status: "running" } });
    reopening.getState().applyUpdate("server", { kind: "upsert", subagent: child });
    reopening.getState().hideFromTrack("server", "parent", [child.id]);
    await vi.waitFor(() => expect(finishRead).toBeTypeOf("function"));
    finishRead("1");
    await vi.waitFor(() => expect(reopening.persist.hasHydrated()).toBe(true));
    await vi.waitFor(() => expect(storage.getAllKeys()).toHaveLength(1));
    const reopened = await openStore(storage);
    expect(
      reopened.getState().hiddenFromTrack.has(providerSubagentKey("server", "parent", child.id)),
    ).toBe(true);
  });
});
