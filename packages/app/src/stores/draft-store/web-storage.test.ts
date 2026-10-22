// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { createWebDraftStorage } from "./web-storage";
import { DRAFT_STORE_VERSION, type DraftRecord, type DraftStoreState } from "./state";

const name = "paseo-drafts";
const envelope = (drafts: Record<string, DraftRecord>) => ({
  state: { drafts, createModalDraft: null } satisfies DraftStoreState,
  version: DRAFT_STORE_VERSION,
});
const draft = (text: string): DraftRecord => ({
  input: { text, attachments: [] },
  lifecycle: "active",
  updatedAt: 1,
  version: 1,
});

beforeEach(() => window.localStorage.clear());

it("keeps a newer feature draft when an older iframe saves another draft", async () => {
  const first = createWebDraftStorage(window.localStorage);
  const original = draft("original");
  await first.setItem(name, envelope({ a: original }));
  const second = createWebDraftStorage(window.localStorage);
  const stale = (await second.getItem(name))!;
  await first.setItem(name, envelope({ a: draft("new text") }));
  await second.setItem(name, {
    ...stale,
    state: { ...stale.state, drafts: { ...stale.state.drafts, b: draft("other feature") } },
  });
  const restored = await createWebDraftStorage(window.localStorage).getItem(name);
  expect(restored?.state.drafts?.a).toEqual(draft("new text"));
  expect(restored?.state.drafts?.b).toEqual(draft("other feature"));
});

it("preserves drafts created after another iframe hydrated, including a sent tombstone", async () => {
  const first = createWebDraftStorage(window.localStorage);
  const second = createWebDraftStorage(window.localStorage);
  await first.getItem(name);
  await second.getItem(name);
  const sent: DraftRecord = { ...draft(""), lifecycle: "sent" };
  await first.setItem(name, envelope({ a: draft("new draft"), sent }));
  await second.setItem(name, envelope({ b: draft("another draft") }));
  expect((await createWebDraftStorage(window.localStorage).getItem(name))?.state).toEqual({
    drafts: { a: draft("new draft"), sent, b: draft("another draft") },
    createModalDraft: null,
  });
});

it("imports legacy drafts without replacing upgraded records or resurrecting pruned drafts", async () => {
  const upgraded = createWebDraftStorage(window.localStorage);
  await upgraded.setItem(name, envelope({ a: draft("updated"), pruned: draft("old") }));
  await upgraded.setItem(name, envelope({ a: draft("updated") }));
  window.localStorage.setItem(
    name,
    JSON.stringify(envelope({ a: draft("stale"), pruned: draft("stale"), b: draft("legacy") })),
  );
  const restored = await createWebDraftStorage(window.localStorage).getItem(name);
  expect(restored?.state.drafts).toEqual({ a: draft("updated"), b: draft("legacy") });
  expect(window.localStorage.getItem(name)).toBeNull();
});

it("does not resurrect a sent draft from a stale iframe's unrelated save", async () => {
  const first = createWebDraftStorage(window.localStorage);
  await first.setItem(name, envelope({ a: draft("unsent") }));
  const second = createWebDraftStorage(window.localStorage);
  const stale = (await second.getItem(name))!;
  await first.setItem(name, envelope({ a: { ...draft(""), lifecycle: "sent" } }));
  await second.setItem(name, {
    ...stale,
    state: { ...stale.state, drafts: { ...stale.state.drafts, b: draft("other") } },
  });
  expect(
    (await createWebDraftStorage(window.localStorage).getItem(name))?.state.drafts?.a?.lifecycle,
  ).toBe("sent");
});

it("does not prune a draft another iframe has made active again", async () => {
  const first = createWebDraftStorage(window.localStorage);
  await first.setItem(name, envelope({ a: { ...draft(""), lifecycle: "sent" } }));
  const second = createWebDraftStorage(window.localStorage);
  await second.getItem(name);
  await first.setItem(name, envelope({ a: draft("new unsent text") }));
  await second.setItem(name, envelope({}));
  expect((await createWebDraftStorage(window.localStorage).getItem(name))?.state.drafts?.a).toEqual(
    draft("new unsent text"),
  );
});

it("retains the legacy snapshot when importing its records fails", async () => {
  const saved = JSON.stringify(envelope({ a: draft("keep this text") }));
  window.localStorage.setItem(name, saved);
  const unavailable: Storage = {
    get length() {
      return window.localStorage.length;
    },
    key: (index) => window.localStorage.key(index),
    getItem: (key) => window.localStorage.getItem(key),
    removeItem: (key) => window.localStorage.removeItem(key),
    clear: () => window.localStorage.clear(),
    setItem: () => {
      throw new Error("Storage full");
    },
  };
  await expect(createWebDraftStorage(unavailable).getItem(name)).rejects.toThrow("Storage full");
  expect(window.localStorage.getItem(name)).toBe(saved);
  expect((await createWebDraftStorage(window.localStorage).getItem(name))?.state.drafts?.a).toEqual(
    draft("keep this text"),
  );
});
