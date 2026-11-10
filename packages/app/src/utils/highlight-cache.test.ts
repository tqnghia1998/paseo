import { describe, expect, it } from "vitest";
import { highlightToKeyedLines, MAX_HIGHLIGHT_CHARS, tokenizeToLines } from "./highlight-cache";

describe("tokenizeToLines", () => {
  it("returns one token array per line for a supported language", () => {
    const lines = tokenizeToLines("const a = 1;\nconst b = 2;", "ts");
    expect(lines).not.toBeNull();
    expect(lines).toHaveLength(2);
    expect(lines?.[0].some((token) => token.style === "keyword")).toBe(true);
  });

  it("returns null when there is no filename", () => {
    expect(tokenizeToLines("whatever", null)).toBeNull();
  });

  it("falls back to style-less per-line tokens for an unknown extension", () => {
    const lines = tokenizeToLines("line one\nline two", "unknownext");
    expect(lines).toHaveLength(2);
    expect(lines?.[0]).toEqual([{ text: "line one", style: null }]);
  });

  it("returns null above the size cap so callers fall back to plain text", () => {
    const huge = "x".repeat(MAX_HIGHLIGHT_CHARS + 1);
    expect(tokenizeToLines(huge, "ts")).toBeNull();
  });

  it("serves a cached result on repeat calls (identity-stable)", () => {
    const first = tokenizeToLines("const cached = true;", "ts");
    const second = tokenizeToLines("const cached = true;", "ts");
    expect(first).toBe(second);
  });
});

describe("highlightToKeyedLines", () => {
  it("produces stable keys for lines and tokens", () => {
    const keyed = highlightToKeyedLines("const a = 1;", "ts");
    expect(keyed?.[0].key).toBe("line-0");
    expect(keyed?.[0].tokens[0].key).toBe("0-0");
  });

  it("returns null when highlighting is unavailable", () => {
    expect(highlightToKeyedLines("text", null)).toBeNull();
  });
});

describe("highlight cache memory budget", () => {
  it("releases old large token arrays before reaching the entry count limit", () => {
    const source = (i: number) =>
      `// memory-budget document ${i}\n` + "const value = 123;\n".repeat(1400);
    const first = tokenizeToLines(source(0), "ts");
    expect(first).not.toBeNull();
    for (let i = 1; i < 20; i++) expect(tokenizeToLines(source(i), "ts")).not.toBeNull();
    const latest = tokenizeToLines(source(19), "ts");
    expect(tokenizeToLines(source(19), "ts")).toBe(latest);
    expect(tokenizeToLines(source(0), "ts")).not.toBe(first);
  });

  it("keeps frequently reused small results while large older entries are evicted", () => {
    const source = "const frequentlyRead = true;";
    const hot = tokenizeToLines(source, "ts");
    for (let i = 0; i < 20; i++) {
      expect(
        tokenizeToLines(`// hot-budget ${i}\n` + "const value = 456;\n".repeat(1400), "ts"),
      ).not.toBeNull();
      expect(tokenizeToLines(source, "ts")).toBe(hot);
    }
  });
});
