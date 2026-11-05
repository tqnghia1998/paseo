import { describe, expect, test, vi } from "vitest";
import { createTrackDismissalStorage } from "./track-dismissal-storage";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getAllKeys: () => [...entries.keys()],
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: vi.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      entries.delete(key);
    }),
  };
}

describe("track dismissal writes", () => {
  test("a delayed dismissal finishes before a resumed child's removal", async () => {
    const storage = memoryStorage();
    let finish!: () => void;
    storage.setItem.mockImplementationOnce(
      (key, value) =>
        new Promise<void>((resolve) => {
          finish = () => {
            storage.entries.set(key, value);
            resolve();
          };
        }),
    );
    const adapter = createTrackDismissalStorage(storage);
    await adapter.getItem("dismissals");
    const hide = adapter.setItem("dismissals", { state: { hiddenFromTrack: ["child"] } });
    const reveal = adapter.reveal("child");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(storage.removeItem).not.toHaveBeenCalled();
    finish();
    await Promise.all([hide, reveal]);
    expect(storage.entries.size).toBe(0);
    const reopened = createTrackDismissalStorage(storage);
    expect((await reopened.getItem("dismissals"))?.state.hiddenFromTrack).toEqual([]);
  });

  test("a failed write is retried even if the state reference is unchanged", async () => {
    const storage = memoryStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      storage.setItem.mockRejectedValueOnce(new Error("Storage unavailable"));
      const adapter = createTrackDismissalStorage(storage);
      await adapter.getItem("dismissals");
      const value = { state: { hiddenFromTrack: ["child"] } };
      await adapter.setItem("dismissals", value);
      expect(storage.entries.size).toBe(0);
      await adapter.setItem("dismissals", value);
      expect(storage.entries.size).toBe(1);
      expect(storage.setItem).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
  test("a failed reveal from another frame is retried on the next snapshot", async () => {
    const storage = memoryStorage();
    const adapter = createTrackDismissalStorage(storage);
    await adapter.getItem("dismissals");
    storage.entries.set("provider-subagent-track-dismissal:child", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      storage.removeItem.mockRejectedValueOnce(new Error("Storage unavailable"));
      await adapter.reveal("child");
      expect(storage.entries.size).toBe(1);
      await adapter.setItem("dismissals", { state: { hiddenFromTrack: [] } });
      expect(storage.entries.size).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
