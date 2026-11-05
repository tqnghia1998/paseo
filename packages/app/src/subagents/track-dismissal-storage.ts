import type { PersistStorage, StateStorage } from "zustand/middleware";

export interface TrackDismissals {
  hiddenFromTrack: string[];
}

export type TrackDismissalStorage = StateStorage & {
  getAllKeys(): readonly string[] | Promise<readonly string[]>;
};

const PREFIX = "provider-subagent-track-dismissal:";

/** Each child owns a key so independently mounted workspace frames cannot overwrite each other. */
export function createTrackDismissalStorage(
  storage: TrackDismissalStorage,
): PersistStorage<TrackDismissals> & {
  reveal(key: string): Promise<void>;
} {
  let previous = new Set<string>();
  let previousState: TrackDismissals | undefined;
  let queuedState: TrackDismissals | undefined;
  let reading = false;
  let pending = Promise.resolve();
  const pendingReveals = new Set<string>();
  const removedWhileReading = new Set<string>();
  const revealPending = async () => {
    for (const key of pendingReveals) {
      await storage.removeItem(PREFIX + key);
      pendingReveals.delete(key);
      previous.delete(key);
      if (reading) removedWhileReading.add(key);
    }
  };
  const enqueue = (write: () => Promise<void>) => {
    pending = pending.then(write).catch((error: unknown) => {
      // Keep successful per-key writes, but retry an incomplete snapshot on the next update.
      previousState = undefined;
      queuedState = undefined;
      console.warn("Failed to save subagent track dismissals", error);
    });
    return pending;
  };
  return {
    async getItem() {
      reading = true;
      removedWhileReading.clear();
      try {
        const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
        const values = await Promise.all(keys.map((key) => storage.getItem(key)));
        previous = new Set(
          keys.filter((_, index) => values[index] === "1").map((key) => key.slice(PREFIX.length)),
        );
        for (const key of removedWhileReading) previous.delete(key);
        previousState = undefined;
        return { state: { hiddenFromTrack: [...previous] }, version: 0 };
      } finally {
        reading = false;
      }
    },
    setItem(_name, value) {
      if (reading || queuedState === value.state) return pending;
      queuedState = value.state;
      return enqueue(async () => {
        await revealPending();
        if (previousState === value.state) return;
        const next = new Set(value.state.hiddenFromTrack);
        for (const key of next) {
          if (previous.has(key)) continue;
          await storage.setItem(PREFIX + key, "1");
          previous.add(key);
        }
        for (const key of previous) {
          if (next.has(key)) continue;
          await storage.removeItem(PREFIX + key);
          previous.delete(key);
        }
        previousState = value.state;
      });
    },
    reveal(key) {
      // A sibling frame may have dismissed this child after our initial read.
      return enqueue(async () => {
        pendingReveals.add(key);
        await revealPending();
        previousState = undefined;
        queuedState = undefined;
      });
    },
    removeItem() {
      return enqueue(async () => {
        for (const key of previous) {
          await storage.removeItem(PREFIX + key);
          previous.delete(key);
        }
        previousState = undefined;
        queuedState = undefined;
      });
    },
  };
}
