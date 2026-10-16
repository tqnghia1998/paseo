import { describe, expect, it } from "vitest";
import {
  createAssistantMarkdownParser,
  normalizeAssistantCitations,
} from "./assistant-markdown-parser";
import { createMarkdownParser } from "./markdown-parser";

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

  it("renders unresolved web citations without leaking provider reference IDs", () => {
    const parser = createAssistantMarkdownParser();
    const citation = "\uE200cite\uE202turn511321view1\uE202turn446758search3\uE201";

    expect(parser.renderInline(`AI tracing.${citation}`)).toBe("AI tracing.[source unavailable]");
    expect(parser.render(`- Frontend.${citation}\n- AI.${citation}`)).toBe(
      "<ul>\n<li>Frontend.[source unavailable]</li>\n<li>AI.[source unavailable]</li>\n</ul>\n",
    );
  });

  it("hides every partial citation while streaming and reveals its fallback when complete", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    const citation = "\uE200cite\uE202turn511321view1\uE202turn446758search3\uE201";

    for (let length = 1; length < citation.length; length++) {
      expect(parser.renderInline("AI tracing." + citation.slice(0, length))).toBe("AI tracing.");
    }
    expect(parser.renderInline("AI tracing." + citation)).toBe("AI tracing.[source unavailable]");
  });

  it("preserves citation syntax in literal code and non-assistant markdown", () => {
    const citation = "\uE200cite\uE202turn511321view1\uE201";
    expect(createMarkdownParser({ linkify: true }).renderInline(citation)).toBe(citation);
    for (const streaming of [false, true]) {
      const parser = createAssistantMarkdownParser({ streaming });
      expect(parser.renderInline("`" + citation + "`")).toBe(`<code>${citation}</code>`);
      expect(parser.render("```text\n" + citation + "\n```")).toBe(
        `<pre><code class="language-text">${citation}\n</code></pre>\n`,
      );
    }
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
