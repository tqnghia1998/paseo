import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import type MarkdownIt from "markdown-it";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser({
  streaming = false,
}: { streaming?: boolean } = {}): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Rich clipboard HTML preserves workspace file links.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  // The transcript carries citation IDs, but no ID-to-source lookup. Keep that
  // limitation visible without rendering private-use glyphs or inventing URLs.
  parser.core.ruler.after("inline", "assistant_citations", (state) => {
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== "text") continue;
        token.content = replaceCitations(token.content, streaming);
      }
    }
  });

  return parser;
}

function replaceCitations(text: string, streaming: boolean): string {
  text = text.replace(/\uE200cite\uE202[^\uE200\uE201]*\uE201/g, "[source unavailable]");
  return streaming
    ? text.replace(/\uE200(?:c(?:i(?:t(?:e(?:\uE202[^\uE200\uE201]*)?)?)?)?)?$/, "")
    : text;
}

// The shared renderer consumes markdown source rather than MarkdownIt tokens.
// Only edit prose nodes, keeping literal code and link destinations untouched.
export function normalizeAssistantCitations(source: string, streaming: boolean): string {
  if (!source.includes("\uE200")) return source;
  const edits: { start: number; end: number; text: string }[] = [];
  function visit(node: Nodes) {
    if (node.type === "text") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const original = source.slice(start, end);
        const text = replaceCitations(original, streaming);
        if (text !== original) edits.push({ start, end, text });
      }
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(source));
  for (const edit of edits.toReversed()) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}
