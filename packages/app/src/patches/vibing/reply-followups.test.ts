import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";
import {
  hasReplyFollowupsRenderer,
  REPLY_FOLLOWUPS_HEADING,
  REPLY_FOLLOWUPS_MAX_PROMPT_LENGTH,
  REPLY_FOLLOWUPS_ROW_KIND,
  resolveHasReplyFollowups,
  stripReplyFollowupsFooter,
  stripReplyFollowupsFromItems,
} from "./reply-followups";

const heading = REPLY_FOLLOWUPS_HEADING;

interface PluginSuggestionsModule {
  ROW_KIND: string;
  HEADING: string;
  MAX_PROMPT_LENGTH: number;
  readSuggestions(text: string): string[];
}

describe("stripReplyFollowupsFooter (complete)", () => {
  it("stays 100% equivalent to plugins/reply-followups/shared/suggestions.ts", async () => {
    const pluginPath = path.resolve(
      __dirname,
      "../../../../../plugins/reply-followups/shared/suggestions.ts",
    );
    const plugin = (await import(pathToFileURL(pluginPath).href)) as PluginSuggestionsModule;
    expect(REPLY_FOLLOWUPS_ROW_KIND).toBe(plugin.ROW_KIND);
    expect(REPLY_FOLLOWUPS_HEADING).toBe(plugin.HEADING);
    expect(REPLY_FOLLOWUPS_MAX_PROMPT_LENGTH).toBe(plugin.MAX_PROMPT_LENGTH);

    const corpus = [
      "Done.",
      `Done.\n\n${heading}\n- Run the focused tests`,
      `Done.\r\n\r\n${heading}\r\n- Run the focused tests\r\n- 重跑測試\r\n`,
      `${heading}\n- Show the changes`,
      `Done.\n${heading}\n- Missing blank line`,
      `Done.\n\n${heading}\n- Run tests\n\nMore prose`,
      `Done.\n\n${heading}\n- One\n- Two\n- Three\n- Four`,
      `Done.\n\n${heading}\n- Run tests\n- run tests`,
      `Done.\n\n${heading}\n- ${"x".repeat(120)}`,
      `Done.\n\n${heading}\n- ${"x".repeat(121)}`,
      `Done.\n\n${heading}\n- \u00A0`,
      `Done.\n\n${heading}\n- \u2003Run tests\u2003`,
      `\`\`\`md\n${heading}\n- Example`,
      `\`\`\`md\n${heading}\n- Example\n\`\`\``,
      `~~~\n${heading}\n- Example\n~~~\n\n${heading}\n- Real prompt`,
      `Done.\n\n${heading}\n- [Open](https://example.test)`,
      `Done.\n\n${heading}\n- Run \`pnpm test\``,
      `Done.\n\n${heading}\n- Run <tag>`,
      `Done.\n\n${heading}\n- Run\u202Ethis`,
    ];

    for (const sample of corpus) {
      const hasSuggestions = plugin.readSuggestions(sample).length > 0;
      const wasStripped = stripReplyFollowupsFooter(sample, "complete") !== sample;
      expect(wasStripped, `Mismatch on sample: ${JSON.stringify(sample)}`).toBe(hasSuggestions);
    }
  });

  it("strips valid one- and two-bullet trailing sections and preserves prior prose", () => {
    expect(
      stripReplyFollowupsFooter(
        `Done.\r\n\r\n${heading}\r\n- Run the focused tests\r\n- 重跑測試\r\n`,
        "complete",
      ),
    ).toBe("Done.");
    expect(
      stripReplyFollowupsFooter(`Line 1\n\nLine 2\n\n${heading}\n- Show the diff`, "complete"),
    ).toBe("Line 1\n\nLine 2");
    expect(stripReplyFollowupsFooter(`${heading}\n- Show the changes`, "complete")).toBe("");
  });

  it("strips the footer after a genui fence without altering the fence", () => {
    const cardBlock = `Here is the summary.\n\n\`\`\`ui\nCard("Status", [Metric("Tests", "42")])\n\`\`\``;
    expect(
      stripReplyFollowupsFooter(`${cardBlock}\n\n${heading}\n- Run the full suite`, "complete"),
    ).toBe(cardBlock);
    expect(stripReplyFollowupsFooter(`${cardBlock}\n\n**Possible next`, "streaming")).toBe(
      cardBlock,
    );
  });
});

describe("stripReplyFollowupsFooter (streaming)", () => {
  it.each([
    `Done.\n\n**`,
    `Done.\n\n**P`,
    `Done.\n\n**Possible`,
    `Done.\r\n\r\n**Possible\r`,
    `Done.\n\n**Possible next prompt`,
    `Done.\n\n${heading}`,
    `Done.\r\n\r\n${heading}\r`,
    `Done.\n\n${heading}\n`,
    `Done.\n\n${heading}\n-`,
    `Done.\r\n\r\n${heading}\r\n-\r`,
    `Done.\n\n${heading}\n- `,
    `Done.\n\n${heading}\n- Run the foc`,
    `Done.\n\n${heading}\n- Run the focused tests\n`,
    `Done.\n\n${heading}\n- Run the focused tests\n-`,
    `Done.\n\n${heading}\n- Run the focused tests\n- Check the di`,
    `Done.\n\n${heading}\n- Run the focused tests\n- Check the diff\n`,
    `Done.\n\n${heading}\n- One\n- Two\n- Three\n- Four`,
  ])("hides an in-progress valid footer while streaming (including CRLF splits): %s", (text) => {
    expect(stripReplyFollowupsFooter(text, "streaming")).toBe("Done.");
  });

  it("allows a second bullet that currently starts with the first bullet's text while typing", () => {
    expect(stripReplyFollowupsFooter(`Done.\n\n${heading}\n- Run\n- Run`, "streaming")).toBe(
      "Done.",
    );
    expect(stripReplyFollowupsFooter(`Done.\n\n${heading}\n- Run\n- Run\n`, "streaming")).toBe(
      `Done.\n\n${heading}\n- Run\n- Run\n`,
    );
  });

  it.each([
    "Done.\n\n*",
    "Done.\n\n**Plan**",
    "Done.\n\n**Possible causes:**",
    `Done.\n${heading}\n- Missing blank line`,
    `Done.\n\n${heading}\nNot a bullet`,
    `Done.\n\n${heading}\n- Run\n- run\n- Third`,
    `Done.\n\n${heading}\n- Run tests\n\nMore prose`,
    `Done.\n\n${heading}\n- [Open](https://example.test)`,
    `\`\`\`md\n${heading}\n- Example`,
    `\`\`\`md\n**Possible`,
  ])("reveals text immediately when streaming diverges from a valid footer: %s", (text) => {
    expect(stripReplyFollowupsFooter(text, "streaming")).toBe(text);
  });
});

describe("stripReplyFollowupsFromItems", () => {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  const assistant = (id: string, text: string, turnId?: string): AssistantMessageItem => ({
    kind: "assistant_message",
    id,
    text,
    timestamp,
    ...(turnId ? { turnId } : {}),
  });

  it("preserves array and item identity when no item changes and caches stripped items", () => {
    const cache = new WeakMap<AssistantMessageItem, AssistantMessageItem | null>();
    const plain: StreamItem[] = [assistant("a1", "Plain reply.", "t1")];
    expect(stripReplyFollowupsFromItems(plain, "complete", cache)).toBe(plain);

    const withFooter = assistant("a2", `Done.\n\n${heading}\n- Run tests`, "t2");
    const items: StreamItem[] = [withFooter];
    const first = stripReplyFollowupsFromItems(items, "complete", cache);
    const second = stripReplyFollowupsFromItems(items, "complete", cache);
    expect(first).not.toBe(items);
    expect(first[0]).toMatchObject({ kind: "assistant_message", id: "a2", text: "Done." });
    expect(second[0]).toBe(first[0]);
  });

  it("omits footer-only replies instead of leaving an empty AssistantMessage shell", () => {
    const cache = new WeakMap<AssistantMessageItem, AssistantMessageItem | null>();
    const footerOnly = assistant("a-only", `${heading}\n- Run tests`, "t1");
    expect(stripReplyFollowupsFromItems([footerOnly], "complete", cache)).toEqual([]);
  });

  it("strips only turn-final replies and leaves intermediate or error-terminated turns intact", () => {
    const cache = new WeakMap<AssistantMessageItem, AssistantMessageItem | null>();
    const footerText = `Step done.\n\n${heading}\n- Next`;
    const items: StreamItem[] = [
      // Turn 1: non-final assistant message before a tool call + final assistant message
      { kind: "user_message", id: "u1", text: "Go", timestamp, turnId: "t1" },
      assistant("a1-mid", footerText, "t1"),
      {
        kind: "tool_call",
        id: "tc1",
        timestamp,
        turnId: "t1",
        payload: {
          source: "agent",
          data: {
            provider: "codex",
            callId: "c1",
            name: "Bash",
            status: "completed",
            error: null,
            detail: { type: "unknown", input: {}, output: {} },
          },
        },
      },
      assistant("a1-final", `All green.\n\n${heading}\n- Ship it`, "t1"),
      // Daemon-appended plugin row with no turnId must not block Turn 1's final reply or leak from Turn 2
      {
        kind: "plugin",
        id: "reply-followups/reply-followups",
        pluginId: "reply-followups",
        pluginItemId: "reply-followups",
        itemKind: "reply-followups",
        version: 1,
        data: { prompts: ["Ship it"] },
        timestamp,
      },
      // Turn 2: failed turn ending with an error notification
      { kind: "user_message", id: "u2", text: "Retry", timestamp, turnId: "t2" },
      assistant("a2-failed", footerText, "t2"),
      {
        kind: "notification",
        id: "err2",
        level: "error",
        sourceType: "error",
        message: "Turn failed",
        timestamp,
        turnId: "t2",
      },
    ];

    const projected = stripReplyFollowupsFromItems(items, "complete", cache);
    const byId = new Map(projected.map((row) => [row.id, row]));
    expect(byId.get("a1-mid")).toMatchObject({ text: footerText });
    expect(byId.get("a1-final")).toMatchObject({ text: "All green." });
    expect(byId.get("a2-failed")).toMatchObject({ text: footerText });
  });

  it("repositions out-of-order reply-followups rows to the end of their own turns while preserving all turns", () => {
    const cache = new WeakMap<AssistantMessageItem, AssistantMessageItem | null>();
    const items: StreamItem[] = [
      { kind: "user_message", id: "u1", text: "Turn 1", timestamp, turnId: "t1" },
      {
        kind: "plugin",
        id: "reply-followups/legacy-1",
        pluginId: "reply-followups",
        pluginItemId: "reply-followups:t1",
        itemKind: REPLY_FOLLOWUPS_ROW_KIND,
        version: 1,
        data: { prompts: ["Old prompt"] },
        timestamp,
      },
      { kind: "assistant_message", id: "a1", text: "Answer 1", timestamp, turnId: "t1" },
      { kind: "user_message", id: "u2", text: "Turn 2", timestamp, turnId: "t2" },
      {
        kind: "plugin",
        id: "reply-followups/reply-followups",
        pluginId: "reply-followups",
        pluginItemId: "reply-followups",
        itemKind: REPLY_FOLLOWUPS_ROW_KIND,
        version: 1,
        data: { prompts: ["Current prompt"] },
        timestamp,
      },
      { kind: "thought", id: "th2", text: "Thinking", status: "ready", timestamp, turnId: "t2" },
      {
        kind: "assistant_message",
        id: "a2",
        text: `Answer 2\n\n${heading}\n- Current prompt`,
        timestamp,
        turnId: "t2",
      },
    ];

    expect(stripReplyFollowupsFromItems(items, "complete", cache).map((row) => row.id)).toEqual([
      "u1",
      "a1",
      "reply-followups/legacy-1",
      "u2",
      "th2",
      "a2",
      "reply-followups/reply-followups",
    ]);
  });

  it("preserves a turn-end reply-followups row from an earlier turn when the latest turn has none", () => {
    const cache = new WeakMap<AssistantMessageItem, AssistantMessageItem | null>();
    const items: StreamItem[] = [
      { kind: "user_message", id: "u1", text: "Turn 1", timestamp, turnId: "t1" },
      { kind: "assistant_message", id: "a1", text: "Answer 1", timestamp, turnId: "t1" },
      {
        kind: "plugin",
        id: "reply-followups/t1",
        pluginId: "reply-followups",
        pluginItemId: "reply-followups:t1",
        itemKind: REPLY_FOLLOWUPS_ROW_KIND,
        version: 1,
        data: { prompts: ["Old prompt"] },
        timestamp,
      },
      { kind: "user_message", id: "u2", text: "Turn 2", timestamp, turnId: "t2" },
      { kind: "assistant_message", id: "a2", text: "Plain answer", timestamp, turnId: "t2" },
    ];

    expect(stripReplyFollowupsFromItems(items, "complete", cache)).toBe(items);
  });
});

describe("hasReplyFollowupsRenderer & resolveHasReplyFollowups", () => {
  const plugins = [
    {
      serverId: "srv-1",
      timelineRenderers: [{ kind: REPLY_FOLLOWUPS_ROW_KIND }],
    },
    {
      serverId: "srv-2",
      timelineRenderers: [{ kind: "genui-block" }],
    },
  ] as unknown as Parameters<typeof hasReplyFollowupsRenderer>[0];

  it("matches enabled plugins and avoids cold-load flashes only while embedded catalog is loading", () => {
    expect(hasReplyFollowupsRenderer(plugins, "srv-1")).toBe(true);
    expect(hasReplyFollowupsRenderer(plugins, "srv-2")).toBe(false);

    expect(
      resolveHasReplyFollowups({
        plugins: [],
        serverId: "srv-1",
        catalogStatus: "loading",
        embedded: true,
      }),
    ).toBe(true);
    expect(
      resolveHasReplyFollowups({
        plugins: [],
        serverId: "srv-1",
        catalogStatus: "ready",
        embedded: true,
      }),
    ).toBe(false);
    expect(
      resolveHasReplyFollowups({
        plugins: [],
        serverId: "srv-1",
        catalogStatus: "loading",
        embedded: false,
      }),
    ).toBe(false);
  });
});
