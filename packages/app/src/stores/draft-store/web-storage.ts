import { z } from "zod";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { PersistedDraftStoreSchema } from "./migration";

type State = z.infer<typeof PersistedDraftStoreSchema>;
const EnvelopeSchema = z.strictObject({
  state: PersistedDraftStoreSchema,
  version: z.number().int().nonnegative().optional(),
});

/** Each iframe writes only records it changed, never its stale copy of other drafts. */
export function createWebDraftStorage(storage: Storage): PersistStorage<State> {
  let previous: State = {};
  const prefix = (name: string) => `${name}:record:`;
  const draftKey = (name: string, id: string) => `${prefix(name)}draft:${id}`;
  const modalKey = (name: string) => `${prefix(name)}modal`;
  const keys = (name: string) =>
    Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key !== null && key.startsWith(prefix(name)),
    );
  const read = (key: string): StorageValue<State> | null => {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      storage.removeItem(key);
      return null;
    }
    const parsed = EnvelopeSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    storage.removeItem(key);
    return null;
  };
  const write = (key: string, value: StorageValue<State>) => {
    storage.setItem(key, JSON.stringify(EnvelopeSchema.parse(value)));
  };

  return {
    getItem: async (name) => {
      const legacy = read(name);
      if (legacy) {
        // Import once without replacing records already saved by an upgraded iframe.
        for (const [id, record] of Object.entries(legacy.state.drafts ?? {})) {
          const key = draftKey(name, id);
          if (storage.getItem(key) === null)
            write(key, { state: { drafts: { [id]: record } }, version: legacy.version });
        }
        if (storage.getItem(modalKey(name)) === null)
          write(modalKey(name), {
            state: { createModalDraft: legacy.state.createModalDraft },
            version: legacy.version,
          });
        storage.removeItem(name);
      }
      const state: State = { drafts: {}, createModalDraft: null };
      let version: number | undefined;
      for (const key of keys(name)) {
        const entry = read(key);
        if (!entry) continue;
        Object.assign(state.drafts!, entry.state.drafts);
        if (key === modalKey(name)) state.createModalDraft = entry.state.createModalDraft;
        version = Math.min(version ?? Infinity, entry.version ?? 0);
      }
      previous = state;
      return { state, version };
    },
    setItem: (name, value) => {
      const drafts = value.state.drafts ?? {};
      const oldDrafts = previous.drafts ?? {};
      for (const id of new Set([...Object.keys(oldDrafts), ...Object.keys(drafts)])) {
        if (drafts[id] === oldDrafts[id]) continue;
        if (!drafts[id]) {
          const committed = read(draftKey(name, id))?.state.drafts?.[id];
          if (JSON.stringify(committed) !== JSON.stringify(oldDrafts[id])) continue;
        }
        // Empty envelopes are deletion tombstones: an old client must not reimport them.
        write(draftKey(name, id), {
          state: { drafts: drafts[id] ? { [id]: drafts[id] } : {} },
          version: value.version,
        });
      }
      if (value.state.createModalDraft !== previous.createModalDraft)
        write(modalKey(name), {
          state: { createModalDraft: value.state.createModalDraft },
          version: value.version,
        });
      previous = value.state;
    },
    removeItem: (name) => {
      for (const key of keys(name)) storage.removeItem(key);
      storage.removeItem(name);
      previous = {};
    },
  };
}
