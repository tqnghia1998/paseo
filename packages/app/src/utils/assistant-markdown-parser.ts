import type MarkdownIt from "markdown-it";
import { createMarkdownParser } from "@/utils/markdown-parser";

export function createAssistantMarkdownParser({ streaming = false }: { streaming?: boolean } = {}): MarkdownIt {
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
        token.content = token.content.replace(
          /\uE200cite\uE202[^\uE200\uE201]*\uE201/g,
          "[source unavailable]",
        );
        if (streaming) {
          token.content = token.content.replace(
            /\uE200(?:c(?:i(?:t(?:e(?:\uE202[^\uE200\uE201]*)?)?)?)?)?$/,
            "",
          );
        }
      }
    }
  });

  return parser;
}
