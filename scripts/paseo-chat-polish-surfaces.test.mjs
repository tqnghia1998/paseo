import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Chat Polish paints menus, listboxes, the Command Center and the selection menu with the host's
// `control` colour in dark. Upstream's light override switched them to `raised` because a white
// theme's control is darker than the page; in Space App Vibing's light palette `control` is the
// raised card (#e6e7ed, lighter than the canvas) and `raised` is the hover tone (#cbd1df), so that
// override made every menu darker than the canvas where dark's are the raised card. Light keeps
// the dark mapping, and a hovered row is the hover tone.
const source = readFileSync(
  new URL("../plugins/paseo-chat-polish/client/paseo-chat-polish.gen.ts", import.meta.url),
  "utf8",
);
const lightRules = source
  .split("\n")
  .filter((line) => line.includes(":root:is(.light, .pluginLight)"));

test("light popup surfaces use control, as dark does", () => {
  assert.ok(
    source.includes("${SURFACE} { background-color: var(--cp-control) !important; }"),
    "dark and light share the control rule",
  );
  assert.ok(
    !lightRules.some((line) => line.includes("${SURFACE} { background-color")),
    "no light override of the popup surface",
  );
  assert.ok(
    !lightRules.some((line) => line.includes("[data-cp-select]")),
    "no light override of the selection menu",
  );
});

test("the light scroll-to-bottom button is the control colour and its hover the hover tone", () => {
  const button = lightRules.find((line) =>
    line.includes('[data-testid="scroll-to-bottom-button"] {'),
  );
  const hover = lightRules.find((line) =>
    line.includes('[data-testid="scroll-to-bottom-button"]:hover'),
  );
  assert.ok(button?.includes("background-color: var(--cp-control) !important"));
  assert.ok(hover?.includes("background-color: var(--cp-raised) !important"));
});

test("a hovered or lit row in light is the hover tone (--cp-raised), not a mix on it", () => {
  const rowRules = lightRules.filter(
    (line) =>
      line.includes('[role="menuitem"]') ||
      line.includes("[data-cp-lit]") ||
      line.includes("${IN_SURFACE}"),
  );
  assert.ok(rowRules.length >= 3);
  for (const rule of rowRules) {
    assert.ok(rule.includes("background-color: var(--cp-raised) !important"), rule.slice(0, 120));
    assert.ok(!rule.includes("color-mix(in srgb, var(--cp-raised)"), rule.slice(0, 120));
  }
});

test("dark rules keep their old expressions", () => {
  assert.ok(
    source.includes(
      "background-color: color-mix(in srgb, var(--cp-control), var(--cp-fg) 12%) !important",
    ),
  );
  assert.ok(source.includes('[data-testid="scroll-to-bottom-button"] { width: 36px'));
});
