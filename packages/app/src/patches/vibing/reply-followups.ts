import { useMemo } from "react";
import { isTurnTrigger } from "@/agent-stream/turn-membership";
import { isEmbeddedFocusMode } from "./focus-mode";
import {
  type PluginCatalogStatus,
  useInstalledPlugins,
  usePluginCatalogStatus,
} from "@/plugins/registry";
import type { InstalledPlugin } from "@/plugins/types";
import type { AssistantMessageItem, StreamItem } from "@/types/stream";

export const REPLY_FOLLOWUPS_ROW_KIND = "reply-followups";
export const REPLY_FOLLOWUPS_HEADING = "**Possible next prompts**";
export const REPLY_FOLLOWUPS_MAX_PROMPT_LENGTH = 120;

const STREAMING_HEADING_MIN_PREFIX = 2;
const INVALID_PROMPT_PATTERN = /[\p{Cc}\p{Bidi_Control}`<>]|\[[^\]]*\]\(/u;

interface IndexedLine {
  text: string;
  start: number;
}

function splitLinesWithOffsets(text: string): IndexedLine[] {
  const lines: IndexedLine[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      const end = i > start && text[i - 1] === "\r" ? i - 1 : i;
      lines.push({ text: text.slice(start, end), start });
      start = i + 1;
    }
  }
  const finalEnd =
    text.length > start && text[text.length - 1] === "\r" ? text.length - 1 : text.length;
  lines.push({ text: text.slice(start, finalEnd), start });
  return lines;
}

function isInsideFence(lines: readonly IndexedLine[], endExclusive: number): boolean {
  let fence: string | undefined;
  for (let i = 0; i < endExclusive; i++) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (!match) continue;
    const [, delimiter, suffix] = match;
    if (!fence) fence = delimiter;
    else if (delimiter[0] === fence[0] && delimiter.length >= fence.length && !suffix.trim()) {
      fence = undefined;
    }
  }
  return Boolean(fence);
}

function parseBulletPrompt(line: string): string | null {
  if (!line.startsWith("- ")) return null;
  const prompt = line.slice(2).trim();
  if (
    !prompt ||
    prompt.length > REPLY_FOLLOWUPS_MAX_PROMPT_LENGTH ||
    INVALID_PROMPT_PATTERN.test(prompt)
  ) {
    return null;
  }
  return prompt;
}

function isValidCompleteBullets(bullets: readonly IndexedLine[]): boolean {
  if (bullets.length < 1) return false;
  const prompts: string[] = [];
  for (const bullet of bullets) {
    const prompt = parseBulletPrompt(bullet.text);
    if (!prompt) return false;
    prompts.push(prompt);
  }
  return new Set(prompts.map((prompt) => prompt.toLowerCase())).size === prompts.length;
}

function isValidStreamingBullets(trailing: readonly IndexedLine[]): boolean {
  let contentLength = trailing.length;
  while (contentLength > 0 && !trailing[contentLength - 1].text.trim()) {
    contentLength--;
  }
  const hasTrailingBlankLine = contentLength < trailing.length;
  const content = trailing.slice(0, contentLength);
  if (content.length === 0) return true;
  if (content.some((line) => !line.text.trim())) return false;

  const seenFinished = new Set<string>();
  for (let i = 0; i < content.length - 1; i++) {
    const prompt = parseBulletPrompt(content[i].text);
    if (!prompt) return false;
    const lower = prompt.toLowerCase();
    if (seenFinished.has(lower)) return false;
    seenFinished.add(lower);
  }

  const lastText = content[content.length - 1].text;
  if (hasTrailingBlankLine) {
    const lastPrompt = parseBulletPrompt(lastText);
    if (!lastPrompt) return false;
    return !seenFinished.has(lastPrompt.toLowerCase());
  }

  if (lastText === "-") return true;
  if (!lastText.startsWith("- ")) return false;
  const partialPrompt = lastText.slice(2).trim();
  return (
    partialPrompt.length <= REPLY_FOLLOWUPS_MAX_PROMPT_LENGTH &&
    !INVALID_PROMPT_PATTERN.test(partialPrompt)
  );
}

function blocksPrecedingReplyFooter(item: StreamItem): boolean {
  switch (item.kind) {
    case "assistant_message":
    case "tool_call":
    case "thought":
    case "todo_list":
      return true;
    case "notification":
      return item.sourceType === "error" || item.level === "error";
    case "user_message":
    case "plugin":
    case "compaction":
    case "turn_summary":
      return false;
  }
}

/**
 * Marks only each turn's final `assistant_message` (not followed in the same turn by work, another
 * `assistant_message`, or an error notification) as eligible for footer stripping, matching both
 * `plugins/reply-followups/index.server.ts` and Chat Polish's unfolded final-reply rule.
 */
function findTurnFinalAssistantIndices(items: readonly StreamItem[]): Set<number> {
  const eligible = new Set<number>();
  let blockedInTurn = false;
  let currentTurnId: string | undefined;

  for (let i = items.length - 1; i >= 0; i--) {
    if (i + 1 < items.length && isTurnTrigger(items[i + 1])) {
      blockedInTurn = false;
      currentTurnId = undefined;
    }
    const item = items[i];
    if (item.turnId !== undefined && currentTurnId !== undefined && item.turnId !== currentTurnId) {
      blockedInTurn = false;
      currentTurnId = item.turnId;
    } else if (item.turnId !== undefined) {
      currentTurnId = item.turnId;
    }

    if (item.kind === "assistant_message" && !blockedInTurn) {
      eligible.add(i);
      blockedInTurn = true;
    } else if (blocksPrecedingReplyFooter(item)) {
      blockedInTurn = true;
    }
  }
  return eligible;
}

/**
 * Removes the trailing Reply follow-ups Markdown section (`**Possible next prompts**`) from
 * assistant prose when the `reply-followups` addon is active, so suggestions appear only as
 * interactive chips. Complete messages match the exact parser contract in
 * `plugins/reply-followups/shared/suggestions.ts`; streaming messages also hide an in-progress
 * valid footer and reveal it immediately if the model diverges into normal prose.
 */
export function stripReplyFollowupsFooter(text: string, phase: "streaming" | "complete"): string {
  if (!text.includes("**")) return text;

  if (phase === "complete") {
    const trimmed = text.trimEnd();
    const lines = splitLinesWithOffsets(trimmed);
    const heading = lines.findLastIndex((line) => line.text === REPLY_FOLLOWUPS_HEADING);
    if (heading < 0 || (heading > 0 && lines[heading - 1].text.trim())) return text;
    if (!isValidCompleteBullets(lines.slice(heading + 1))) return text;
    if (isInsideFence(lines, heading)) return text;
    return trimmed.slice(0, lines[heading].start).trimEnd();
  }

  const rawLines = splitLinesWithOffsets(text);
  const heading = rawLines.findLastIndex((line) => line.text === REPLY_FOLLOWUPS_HEADING);
  if (
    heading >= 0 &&
    (heading === 0 || !rawLines[heading - 1].text.trim()) &&
    isValidStreamingBullets(rawLines.slice(heading + 1)) &&
    !isInsideFence(rawLines, heading)
  ) {
    return text.slice(0, rawLines[heading].start).trimEnd();
  }

  const lastIndex = rawLines.length - 1;
  const lastLine = rawLines[lastIndex].text;
  if (
    lastLine.length >= STREAMING_HEADING_MIN_PREFIX &&
    lastLine.length < REPLY_FOLLOWUPS_HEADING.length &&
    REPLY_FOLLOWUPS_HEADING.startsWith(lastLine) &&
    (lastIndex === 0 || !rawLines[lastIndex - 1].text.trim()) &&
    !isInsideFence(rawLines, lastIndex)
  ) {
    return text.slice(0, rawLines[lastIndex].start).trimEnd();
  }

  return text;
}

function isNonEmptyReplyFollowupsItem(item: StreamItem): boolean {
  if (item.kind !== "plugin" || item.itemKind !== REPLY_FOLLOWUPS_ROW_KIND) return false;
  if (typeof item.data !== "object" || item.data === null || !("prompts" in item.data)) {
    return false;
  }
  const { prompts } = item.data as { prompts?: unknown };
  return Array.isArray(prompts) && prompts.length > 0;
}

/**
 * Legacy pre-fix `reply-followups` rows written on `agent.turn.before` sit ahead of their turn's
 * reasoning, tool calls, and assistant message. Reposition each turn's follow-up row to the end
 * of its own turn while leaving turn-final rows untouched and preserving all turns' chips.
 */
function normalizeFollowupsPlacement(
  items: readonly StreamItem[],
  phase: "streaming" | "complete",
): StreamItem[] | null {
  if (phase !== "complete") return null;

  let needsMove = false;
  for (let i = 0; i < items.length; i++) {
    if (!isNonEmptyReplyFollowupsItem(items[i])) continue;
    const next = items[i + 1];
    if (next && !isTurnTrigger(next) && next.kind !== "compaction") {
      needsMove = true;
      break;
    }
  }
  if (!needsMove) return null;

  const reordered: StreamItem[] = [];
  let deferredInTurn: StreamItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i > 0 && isTurnTrigger(item) && deferredInTurn.length > 0) {
      reordered.push(...deferredInTurn);
      deferredInTurn = [];
    }
    if (isNonEmptyReplyFollowupsItem(item)) {
      deferredInTurn.push(item);
      continue;
    }
    reordered.push(item);
  }
  if (deferredInTurn.length > 0) reordered.push(...deferredInTurn);
  return reordered;
}

export function stripReplyFollowupsFromItems(
  items: StreamItem[],
  phase: "streaming" | "complete",
  cache: WeakMap<AssistantMessageItem, AssistantMessageItem | null>,
): StreamItem[] {
  if (items.length === 0) return items;
  const sourceItems = normalizeFollowupsPlacement(items, phase) ?? items;
  let changed = sourceItems !== items;
  const eligible = findTurnFinalAssistantIndices(sourceItems);
  if (eligible.size === 0) return changed ? sourceItems : items;

  const projected: StreamItem[] = [];
  for (let i = 0; i < sourceItems.length; i++) {
    const item = sourceItems[i];
    if (item.kind !== "assistant_message" || !eligible.has(i)) {
      projected.push(item);
      continue;
    }
    let nextItem = cache.get(item);
    if (nextItem === undefined) {
      const stripped = stripReplyFollowupsFooter(item.text, phase);
      if (stripped === item.text) {
        nextItem = item;
      } else if (stripped === "") {
        nextItem = null;
      } else {
        nextItem = { ...item, text: stripped };
      }
      cache.set(item, nextItem);
    }
    if (nextItem !== item) changed = true;
    if (nextItem !== null) projected.push(nextItem);
  }
  return changed ? projected : items;
}

export function hasReplyFollowupsRenderer(
  plugins: readonly Pick<InstalledPlugin, "serverId" | "timelineRenderers">[],
  serverId: string,
): boolean {
  return plugins.some(
    (plugin) =>
      plugin.serverId === serverId &&
      plugin.timelineRenderers.some((renderer) => renderer.kind === REPLY_FOLLOWUPS_ROW_KIND),
  );
}

export function resolveHasReplyFollowups(input: {
  plugins: readonly Pick<InstalledPlugin, "serverId" | "timelineRenderers">[];
  serverId: string;
  catalogStatus: PluginCatalogStatus;
  embedded: boolean;
}): boolean {
  if (!input.serverId) return false;
  if (hasReplyFollowupsRenderer(input.plugins, input.serverId)) return true;
  return input.embedded && input.catalogStatus === "loading";
}

export function useHasReplyFollowups(serverId: string): boolean {
  const installed = useInstalledPlugins();
  const catalogStatus = usePluginCatalogStatus(serverId);
  return useMemo(
    () =>
      resolveHasReplyFollowups({
        plugins: installed,
        serverId,
        catalogStatus,
        embedded: isEmbeddedFocusMode,
      }),
    [installed, serverId, catalogStatus],
  );
}
