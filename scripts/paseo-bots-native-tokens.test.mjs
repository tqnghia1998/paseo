import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// The Bots plugin's `nativeTokens` colours text and icons on the host's surfaces. With the Space App Vibing palette (the host
// passes `selected`) every token derives from the theme colours by ONE expression for both modes (light differs from dark
// only in the palette's values, docs/theme-sites.md), the contrast floors hold in both modes and the dark values are pinned.
// Without it (standalone Paseo, third-party themes) the tokens are upstream's, unchanged.
const source = readFileSync(
  new URL("../plugins/paseo-bots/client/paseo-bots.gen.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "paseo-bots.js",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function declaration(name) {
  const node = parsed.statements.find(
    (statement) =>
      (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((d) => d.name.getText(parsed) === name)),
  );
  assert.ok(node, `Missing ${name}`);
  return node.getText(parsed);
}
const context = vm.createContext({ WeakMap, Math, parseFloat, parseInt, Number, String });
vm.runInContext(
  ["parseColor", "mix", "lift", "isDark", "cache", "nativeTokens"].map(declaration).join("\n"),
  context,
);
const nativeTokens = (colors) => context.nativeTokens({ ...colors });

// The theme plugin's colours as the Bots plugin sees them (plugins/space-app-vibing-theme: canvas, hover as `raised`, the
// raised card as `control`, text, subdued text, blue) plus the host's faint text (`ring`) and selected tone.
const DARK = {
  surface0: "#1d2125",
  surface1: "#2f363d",
  surface2: "#24292e",
  border: "#2b3137",
  foreground: "#f6f8fa",
  foregroundMuted: "#d1d5da",
  accent: "#79b8ff",
  foregroundExtraMuted: "#959da5",
  selected: "#444d56",
  statusDotRunning: "#5caaf6",
  statusDotSuccess: "#35c264",
  statusDotWarning: "#db932e",
  statusDotDanger: "#f7796d",
};
const LIGHT = {
  surface0: "#ffffff",
  surface1: "#e8e8eb",
  surface2: "#f2f2f6",
  border: "#dddde2",
  foreground: "#202325",
  foregroundMuted: "#5c5e63",
  accent: "#1571be",
  foregroundExtraMuted: "#6d6f71",
  selected: "#d9d9dd",
  // The host's light dots after its readability pass (3:1 on the canvas, hover, raised and selected tones).
  statusDotRunning: "#1f71b8",
  statusDotSuccess: "#217f41",
  statusDotWarning: "#96651e",
  statusDotDanger: "#d6292a",
};
// Upstream's own themes (standalone Paseo): no `selected`, so the plugin keeps its upstream tokens.
const UPSTREAM_LIGHT = {
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  border: "#e4e4e7",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  accent: "#20744a",
  foregroundExtraMuted: "#a1a1aa",
};
const UPSTREAM_DARK = {
  surface0: "#181b1a",
  surface1: "#1e2120",
  surface2: "#272a29",
  border: "#252b2a",
  foreground: "#fafafa",
  foregroundMuted: "#a1a5a4",
  accent: "#20744a",
  foregroundExtraMuted: "#717574",
};

function luminance(hex) {
  const channel = (i) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const drift = (a, b) =>
  Math.max(
    ...[1, 3, 5].map((i) =>
      Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)),
    ),
  );

const nativeTokensSource = declaration("nativeTokens");
const dots = (t) => [t.statusDotRunning, t.statusDotSuccess, t.statusDotWarning, t.statusDotDanger];

test("dark with the palette: every derived value stays within 2/255 of the values that shipped, except the documented changes", () => {
  const t = nativeTokens(DARK);
  // Within 2/255 of the previous release.
  for (const [key, value] of Object.entries({
    surfaceSidebar: "#1d2125",
    surface3: "#3f4449",
    foregroundSelected: "#fdfdfe",
  })) {
    assert.ok(drift(t[key], value) <= 2, `${key} ${t[key]} vs ${value}`);
  }
  assert.equal(t.surface3, "#3f4449");
  assert.equal(t.interactionHighlight, "rgba(255, 255, 255, 0.08)");
  // Documented changes: the selected row is the palette's selected primitive (was the derived #4a5057), the placeholder is
  // the host's faint colour (was #565b5f, 2.36:1 on the canvas), the link is the accent (was #cde5ff) and underlined.
  assert.equal(t.surfaceSidebarSelected, "#444d56");
  assert.equal(t.surface4, "#959da5");
  assert.equal(t.accentBright, "#79b8ff");
  assert.equal(t.linkDecoration, "underline");
  assert.equal(t.foregroundExtraMuted, "#959da5");
  assert.deepEqual(dots(t), ["#5caaf6", "#35c264", "#db932e", "#f7796d"]);
});

test("with the palette there is one expression per token: no mode branch except the highlight overlay", () => {
  const start = nativeTokensSource.indexOf("const tokens = aware");
  const end = nativeTokensSource.indexOf(": (() =>");
  assert.ok(start > 0 && end > start, "found the palette branch");
  const branching = nativeTokensSource
    .slice(start, end)
    .split("\n")
    .filter((line) => /\bdark\b\s*\?/.test(line));
  assert.deepEqual(branching, []);
  const light = nativeTokens(LIGHT);
  assert.equal(light.surfaceSidebarSelected, LIGHT.selected);
  assert.equal(light.foregroundSelected, context.lift(LIGHT.foreground, LIGHT.surface0, 0.03));
  assert.equal(light.surface3, context.mix(LIGHT.surface2, LIGHT.foreground, 0.87));
  assert.equal(light.interactionHighlight, "rgba(0, 0, 0, 0.06)");
  assert.equal(light.linkDecoration, "underline");
  assert.equal(light.accentBright, LIGHT.accent);
  // The shimmer sweep is the pole opposite the canvas: white in dark (upstream's band), black in light.
  assert.equal(nativeTokens(DARK).shimmerHighlight, "#ffffff");
  assert.equal(light.shimmerHighlight, "#000000");
});

test("with the palette every text, placeholder and dot colour holds its floor on each surface it is drawn on, in both modes", () => {
  const failures = [];
  for (const [mode, colors] of [
    ["dark", DARK],
    ["light", LIGHT],
  ]) {
    const t = nativeTokens(colors);
    const canvas = colors.surface0;
    const raised = colors.surface2;
    const hover = colors.surface1;
    const selected = colors.selected;
    const check = (name, color, surfaces, floor) => {
      for (const [label, surface] of Object.entries(surfaces)) {
        const ratio = contrast(color, surface);
        if (ratio < floor)
          failures.push(`${mode} ${name} on ${label}: ${ratio.toFixed(2)} < ${floor}`);
      }
    };
    // Links are drawn in chat on the canvas and on raised fills (4.5:1) and, rarely, on hover fills, where the
    // palette's accent is held at 4.1:1 (a documented exception: SeaTalk's brand blue darkened to 4.5 on the canvas
    // and raised card is 4.15 on the hover tone); selected text on the canvas and the selected row.
    check("link", t.accentBright, { canvas, raised }, 4.5);
    check("link", t.accentBright, { hover }, 4.1);
    check("selected text", t.foregroundSelected, { canvas, selected }, 4.5);
    // Faint text, the placeholder and the dots are UI tones: 3:1 on the canvas, raised, hover and the selected row.
    for (const [name, color] of [
      ["faint", t.foregroundExtraMuted],
      ["placeholder", t.surface4],
      ["dot running", t.statusDotRunning],
      ["dot success", t.statusDotSuccess],
      ["dot warning", t.statusDotWarning],
      ["dot danger", t.statusDotDanger],
    ]) {
      check(name, color, { canvas, raised, hover, selected }, 3);
    }
  }
  // Dark's faint text on the selected row (3.13) is the only floor that dark's own palette leaves under 3 elsewhere; none here.
  assert.deepEqual(failures, []);
});

test("light: the placeholder is the host's faint colour and holds the 3:1 UI floor on every surface", () => {
  const t = nativeTokens(LIGHT);
  assert.equal(t.surface4, LIGHT.foregroundExtraMuted);
  for (const surface of [LIGHT.surface0, LIGHT.surface1, LIGHT.surface2, LIGHT.selected])
    assert.ok(contrast(t.surface4, surface) >= 3, `placeholder on ${surface}`);
});

test("standalone and third-party themes (no `selected`) keep upstream's tokens exactly", () => {
  const light = nativeTokens(UPSTREAM_LIGHT);
  assert.equal(light.aware, false);
  assert.deepEqual(
    {
      surfaceSidebar: light.surfaceSidebar,
      surfaceSidebarSelected: light.surfaceSidebarSelected,
      surface3: light.surface3,
      surface4: light.surface4,
      borderAccent: light.borderAccent,
      foregroundExtraMuted: light.foregroundExtraMuted,
      foregroundSelected: light.foregroundSelected,
      accentBright: light.accentBright,
      linkDecoration: light.linkDecoration,
      shimmerHighlight: light.shimmerHighlight,
    },
    {
      surfaceSidebar: "#f4f4f5",
      surfaceSidebarSelected: "#e5e5e6",
      surface3: "#e5e5e6",
      surface4: "#d3d3d5",
      borderAccent: "#ececee",
      foregroundExtraMuted: "#a3a3a9",
      foregroundSelected: "#1a1a1e",
      accentBright: "#589777",
      linkDecoration: "none",
      shimmerHighlight: undefined,
    },
  );
  assert.deepEqual(dots(light), ["#268ae0", "#299f51", "#b37824", "#f12e2f"]);
  const dark = nativeTokens(UPSTREAM_DARK);
  assert.equal(dark.aware, false);
  assert.deepEqual(
    {
      surfaceSidebar: dark.surfaceSidebar,
      surfaceSidebarSelected: dark.surfaceSidebarSelected,
      surface3: dark.surface3,
      surface4: dark.surface4,
      borderAccent: dark.borderAccent,
      foregroundExtraMuted: dark.foregroundExtraMuted,
      foregroundSelected: dark.foregroundSelected,
      accentBright: dark.accentBright,
      linkDecoration: dark.linkDecoration,
      shimmerHighlight: dark.shimmerHighlight,
    },
    {
      surfaceSidebar: "#141616",
      surfaceSidebarSelected: "#272a29",
      surface3: "#424544",
      surface4: "#5a5c5b",
      borderAccent: "#303534",
      foregroundExtraMuted: "#717574",
      foregroundSelected: "#fafafa",
      accentBright: "#acccbc",
      linkDecoration: "none",
      shimmerHighlight: undefined,
    },
  );
  assert.deepEqual(dots(dark), ["#5caaf6", "#35c264", "#db932e", "#f7796d"]);
});

test("hosts that carry the palette but not the faint or dot colours fall back to one expression", () => {
  const {
    foregroundExtraMuted: _faint,
    statusDotRunning: _a,
    statusDotSuccess: _b,
    statusDotWarning: _c,
    statusDotDanger: _d,
    ...old
  } = LIGHT;
  const t = nativeTokens(old);
  assert.equal(t.foregroundExtraMuted, context.mix(old.foregroundMuted, old.surface0, 0.65));
  assert.equal(t.surface4, t.foregroundExtraMuted);
  assert.deepEqual(dots(t), ["#268ae0", "#299f51", "#b37824", "#f12e2f"]);
});

test("the list, tab strip and splash are the canvas with the palette", () => {
  assert.equal(nativeTokens(LIGHT).surfaceSidebar, LIGHT.surface0);
  assert.equal(nativeTokens(DARK).surfaceSidebar, DARK.surface0);
});

test("the tooltip bubble is the raised card in both modes", () => {
  assert.ok(/backgroundColor: theme \? theme\.surface2 : "#202225"/.test(source));
  assert.ok(!/dark \? theme\.surface2 : theme\.surface0/.test(source));
});

test("the muted badge is surface3 in both modes (no light-only fill)", () => {
  assert.ok(!source.includes("mutedBadgeFill"));
});

test("the plugin's remaining mode branches are the documented exceptions only", () => {
  // Each branch below is listed in docs/vibing-patches.md (accepted exceptions); a new one must be added there.
  const lines = source
    .split("\n")
    .filter(
      (line) => /(?:tokens|nativeTokens\(colors\))\.dark\b/.test(line) || /\bdark \? /.test(line),
    );
  const normalised = lines
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => !line.startsWith("//"));
  const known = [
    /RED_500/, // error text: upstream's red in dark, the theme's statusDanger on a light palette
    /AMBER_500/, // context meter warning
    /style\.tint/, // notification icon tint
    /CHEVRON_COLOR/, // bot row chevron on upstream's dark theme
    /"#a1a1aa"/, // compaction glyph on upstream's dark theme
    /shadowColor: tokens\.dark|shadowRadius: tokens\.dark/, // upstream's shadows
    /tokens\.dark \? 0\.16 : 0\.12/, // upstream's status badge tint strength
    /dark=\{|dark: tokens\.dark/, // avatar and logo artwork variants
    /dark \?/, // the standalone token set and the highlight overlay inside nativeTokens
  ];
  const unknown = normalised.filter((line) => !known.some((pattern) => pattern.test(line)));
  assert.deepEqual(unknown, []);
});
