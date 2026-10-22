import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readClaudeBackgroundShellOutput } from "./background-shells.js";

const directories: string[] = [];

function writeOutput(contents: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "vibing-shell-output-"));
  directories.push(directory);
  const file = path.join(directory, "task.output");
  writeFileSync(file, contents, "utf8");
  return file;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("readClaudeBackgroundShellOutput", () => {
  it("returns a short output whole, without trailing whitespace", () => {
    expect(readClaudeBackgroundShellOutput(writeOutput("line one\nline two\n\n"))).toBe(
      "line one\nline two",
    );
  });

  it("keeps only the last 64 KiB, starting on a whole line", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `line ${index} ${"x".repeat(20)}`);
    const output = readClaudeBackgroundShellOutput(writeOutput(`${lines.join("\n")}\n`));

    expect(output?.startsWith("…\nline ")).toBe(true);
    expect(output?.endsWith(lines.at(-1)!)).toBe(true);
    expect(Buffer.byteLength(output ?? "", "utf8")).toBeLessThanOrEqual(64 * 1024 + 4);
    expect(output?.split("\n")[1]).toMatch(/^line \d+ x{20}$/);
  });

  it("returns undefined for a missing file", () => {
    expect(readClaudeBackgroundShellOutput("/nonexistent/vibing/task.output")).toBeUndefined();
  });
});
