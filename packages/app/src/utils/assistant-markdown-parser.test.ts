import { describe, expect, it } from "vitest";
import {
  createAssistantMarkdownParser,
  normalizeAssistantCitations,
} from "./assistant-markdown-parser";

describe("createAssistantMarkdownParser", () => {
  it("keeps ordinary parsing for completed messages", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("**unfinished")).toBe("**unfinished");
    expect(parser.renderInline("[unfinished")).toBe("[unfinished");
  });

  it("renders agent text verbatim", () => {
    const parser = createAssistantMarkdownParser();

    // The reported bug, plus the substitutions that share its cause.
    expect(parser.renderInline("(c) (C) (r) (tm) (p)")).toBe("(c) (C) (r) (tm) (p)");
    expect(parser.renderInline("wait for it...")).toBe("wait for it...");
    expect(parser.renderInline("a -- b")).toBe("a -- b");
    // Smart quotes are off too: a curled quote is not pasteable into a shell.
    expect(parser.renderInline(`run --name="my repo"`)).toBe("run --name=&quot;my repo&quot;");
    expect(parser.renderInline("it's fine")).toBe("it's fine");
  });

  it("allows file:// links, unlike every other parser", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[open](file:///tmp/a.ts)")).toContain('href="file:///tmp/a.ts"');
  });

  it("still rejects javascript: links", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });
});

describe("normalizeAssistantCitations", () => {
  const citation = "\uE200cite\uE202turn511321view1\uE201";
  it("adapts prose for the shared markdown renderer while preserving literal code and links", () => {
    const source = `AI.${citation}\n\n- **Result${citation}**\n\n\`${citation}\`\n\n\`\`\`text\n${citation}\n\`\`\`\n\n[APMS](https://example.com/apms)`;
    const result = normalizeAssistantCitations(source, false);
    expect(result).toBe(
      source
        .replace(`AI.${citation}`, "AI.[source unavailable]")
        .replace(`Result${citation}`, "Result[source unavailable]"),
    );
  });
  it("hides partial streamed markers and reveals the fallback on completion", () => {
    for (let length = 1; length < citation.length; length++) {
      expect(normalizeAssistantCitations(`AI.${citation.slice(0, length)}`, true)).toBe("AI.");
    }
    expect(normalizeAssistantCitations(`AI.${citation}`, true)).toBe("AI.[source unavailable]");
  });
});
