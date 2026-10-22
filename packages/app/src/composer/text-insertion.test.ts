import { describe, expect, it, vi } from "vitest";
import {
  insertComposerText,
  registerComposerTextInsertion,
  observeComposerDrafts,
  registerComposerDraft,
} from "./text-insertion";

describe("composer text insertion", () => {
  it("targets the local host and agent and rejects unavailable composers", () => {
    const insert = vi.fn();
    const target = { serverId: "host", agentId: "agent" };
    const cleanup = registerComposerTextInsertion(target, insert);
    try {
      expect(() => insertComposerText({ ...target, serverId: "other", text: "Review" })).toThrow();
      expect(() => insertComposerText({ ...target, agentId: "other", text: "Review" })).toThrow();
      expect(() => insertComposerText({ ...target, text: " " })).toThrow();
      insertComposerText({ ...target, text: "Review" });
      expect(insert.mock.calls).toEqual([["Review"]]);
    } finally {
      cleanup();
    }
    expect(() => insertComposerText({ ...target, text: "Review" })).toThrow();
  });

  it("does not remove a replacement composer when the previous one unmounts", () => {
    const target = { serverId: "host", agentId: "agent" };
    const previous = registerComposerTextInsertion(target, () => {});
    const insert = vi.fn();
    const cleanup = registerComposerTextInsertion(target, insert);
    previous();
    try {
      insertComposerText({ ...target, text: "Review" });
      expect(insert).toHaveBeenCalledWith("Review");
    } finally {
      cleanup();
    }
  });
});

describe("composer draft observation", () => {
  it("reports host-scoped drafts and removes them when they become unavailable", async () => {
    const updates = vi.fn();
    const stop = observeComposerDrafts("host", updates);
    const send = vi.fn().mockResolvedValue(undefined);
    const other = registerComposerDraft("other", {
      agentId: "draft",
      workspaceId: "workspace",
      send,
    });
    const remove = registerComposerDraft("host", {
      agentId: "draft",
      workspaceId: "workspace",
      send,
    });
    try {
      expect(updates.mock.calls[0]).toEqual([[]]);
      const [draft] = updates.mock.lastCall![0];
      expect(draft).toMatchObject({
        agentId: "draft",
        workspaceId: "workspace",
      });
      await draft.send("Review this");
      expect(send).toHaveBeenCalledWith("Review this");
      remove();
      expect(updates.mock.lastCall).toEqual([[]]);
      const count = updates.mock.calls.length;
      stop();
      other();
      expect(updates.mock.calls.length).toBe(count);
    } finally {
      stop();
      remove();
      other();
    }
  });

  it("keeps a replacement draft when an older registration is cleaned up", () => {
    const updates = vi.fn();
    const stop = observeComposerDrafts("host", updates);
    const draft = { agentId: "draft", workspaceId: "workspace", send: vi.fn() };
    const old = registerComposerDraft("host", draft);
    const remove = registerComposerDraft("host", draft);
    try {
      old();
      expect(updates.mock.lastCall![0]).toHaveLength(1);
      remove();
      expect(updates.mock.lastCall).toEqual([[]]);
    } finally {
      stop();
      old();
      remove();
    }
  });
});
