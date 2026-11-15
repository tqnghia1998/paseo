import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Chat Polish paints menus, listboxes, the Command Center and the selection menu with the host's `control` colour in dark.
// Upstream's light override switched them to `raised` because a white theme's control is darker than the page; in Space App
// Vibing's light palette `control` is the raised card (lighter than the canvas), so that override made every menu darker
// than the canvas where dark's are the raised card. Light keeps the dark mapping, and a hovered, selected or lit row is one
// expression in both modes: the control colour mixed 12% toward the text (1.2:1 against the menu in light, 1.3 to 1.4:1 in dark).
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

test("the scroll-to-bottom button keeps its control fill and hover mix in light; only its shadow is softer", () => {
  const button = lightRules.find((line) =>
    line.includes('[data-testid="scroll-to-bottom-button"] {'),
  );
  assert.ok(button?.includes("box-shadow: 0 4px 14px"));
  assert.ok(!button?.includes("background-color"));
  assert.ok(
    !lightRules.some((line) => line.includes('[data-testid="scroll-to-bottom-button"]:hover')),
  );
});

test("a hovered, selected or lit row has no light override: one expression in both modes", () => {
  assert.deepEqual(
    lightRules.filter(
      (line) =>
        line.includes('[role="menuitem"]') ||
        line.includes("[data-cp-lit]") ||
        line.includes("${IN_SURFACE}"),
    ),
    [],
  );
});

test("the shared row expression is the dark one, for menu rows, track rows and lit rows", () => {
  assert.ok(
    source.includes(
      "background-color: color-mix(in srgb, var(--cp-control), var(--cp-fg) 12%) !important",
    ),
  );
  assert.ok(source.includes('[data-testid="scroll-to-bottom-button"] { width: 36px'));
  for (const selector of [
    "[data-cp-lit] {",
    '${TRACK_PANEL} [role="menuitem"]:is(:hover, :focus-visible) > div {',
    '[data-testid="scroll-to-bottom-button"]:hover {',
  ])
    assert.ok(
      source
        .split("\n")
        .some(
          (line) =>
            line.includes(selector) &&
            line.includes("color-mix(in srgb, var(--cp-control), var(--cp-fg) 12%)"),
        ),
      selector,
    );
});
