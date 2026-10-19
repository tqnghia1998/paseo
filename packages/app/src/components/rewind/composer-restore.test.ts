import { describe, expect, test } from "vitest";
import { restoreComposerTextIfEmpty } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";
import { getLiveDesignRewindText } from "@/patches/vibing/live-design";

test("rewinding Live Design restores editable note context without replacing a draft", () => {
  const message = "Apply this Live Design note.";
  const attachment = {
    type: "text" as const,
    mimeType: "text/plain" as const,
    title: "Live Design context",
    text: 'Prepared context: [{"comment":"Make Save red"}]',
  };
  const rewoundText = getLiveDesignRewindText(message, [attachment]);
  expect(restoreComposerTextIfEmpty({ currentText: "", rewoundText })).toBe(
    `${message}\n\n${attachment.text}`,
  );
  expect(restoreComposerTextIfEmpty({ currentText: "Keep my draft", rewoundText })).toBe(
    "Keep my draft",
  );
  expect(getLiveDesignRewindText("Ordinary message", [])).toBe("Ordinary message");
  expect(
    getLiveDesignRewindText("Ordinary message", [{ ...attachment, title: "Other context" }]),
  ).toBe("Ordinary message");
});

describe("restoreComposerTextIfEmpty", () => {
  test("restores the rewound message when the composer is empty", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "",
        rewoundText: "message before rewind",
      }),
    ).toBe("message before rewind");
  });

  test("preserves an existing composer draft", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "keep this draft",
        rewoundText: "message before rewind",
      }),
    ).toBe("keep this draft");
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});
