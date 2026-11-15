import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const focus = vi.hoisted(() => ({ embedded: true }));
vi.mock("./focus-mode", () => ({
  get isEmbeddedFocusMode() {
    return focus.embedded;
  },
  isEmbeddedChiefView: false,
}));

const {
  resolveChatFillRing,
  resolveChatFillSurface,
  resolveComposerPillHover,
  resolveComposerSurface,
} = await import("./composer-pill-hover");

const light = {
  colorScheme: "light",
  colors: { composerSurface: "#dddfe5", surface2: "#e6e7ed", foreground: "#343b59" },
} as const;
const dark = {
  colorScheme: "dark",
  colors: { composerSurface: "#2f363d", surface2: "#24292e", foreground: "#f6f8fa" },
} as const;
const lightSurfaces = {
  colorScheme: "light",
  colors: { surface0: "#d6d8df", surface1: "#cbcdd3", surface2: "#e6e7ed" },
} as const;
const darkSurfaces = {
  colorScheme: "dark",
  colors: { surface0: "#1d2125", surface1: "#2f363d", surface2: "#24292e" },
} as const;

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("resolveComposerSurface", () => {
  beforeEach(() => {
    focus.embedded = true;
  });

  it("is the Details box tone in embedded light: the canvas mixed 45% toward the control colour", () => {
    const surface = resolveComposerSurface(lightSurfaces);
    expect(surface).toBe("#dddfe5");
    // Neutral like the grey it replaces (#cbcdd3): the same r/g/b spread of 8, not a blue-leaning tint.
    const spread = (hex: string) => Math.max(...channels(hex)) - Math.min(...channels(hex));
    expect(spread(surface)).toBeLessThanOrEqual(spread("#cbcdd3"));
    expect(luminance(surface)).toBeGreaterThan(luminance("#d6d8df"));
    expect(luminance(surface)).toBeLessThan(luminance("#e6e7ed"));
  });

  it("keeps text, accents and placeholders readable on it", () => {
    const surface = resolveComposerSurface(lightSurfaces);
    expect(ratio("#343b59", surface)).toBeGreaterThanOrEqual(7);
    expect(ratio("#4c505e", surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#686a77", surface)).toBeGreaterThanOrEqual(3);
    expect(ratio("#395d99", surface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#c1c2c7", surface)).toBeGreaterThanOrEqual(1.25);
  });

  it("leaves dark byte-identical (surface1)", () => {
    expect(resolveComposerSurface(darkSurfaces)).toBe("#2f363d");
  });

  it("leaves standalone light on surface1", () => {
    focus.embedded = false;
    expect(resolveComposerSurface(lightSurfaces)).toBe("#cbcdd3");
  });

  it("mixes any other CSS colour in the browser (web style sheets only see var() references)", () => {
    expect(
      resolveComposerSurface({
        colorScheme: "light",
        colors: {
          surface0: "var(--colors-surface0)",
          surface1: "var(--colors-surface1)",
          surface2: "var(--colors-surface2)",
        },
      }),
    ).toBe("color-mix(in srgb, var(--colors-surface0) 55%, var(--colors-surface2))");
  });
});

describe("resolveComposerPillHover", () => {
  beforeEach(() => {
    focus.embedded = true;
  });

  it("is a neutral step darker than the resting pill in embedded light", () => {
    const hover = resolveComposerPillHover(light);
    expect(hover).toBe("#d5d7de");
    expect(luminance(hover)).toBeLessThan(luminance(light.colors.composerSurface));
    expect(luminance(hover)).toBeLessThan(luminance("#d6d8df"));
  });

  it("keeps the label contrast on the hovered pill", () => {
    const hover = resolveComposerPillHover(light);
    expect(ratio("#343b59", hover)).toBeGreaterThanOrEqual(7);
    expect(ratio("#4c505e", hover)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves dark byte-identical", () => {
    expect(resolveComposerPillHover(dark)).toBe("#24292e");
  });

  it("leaves standalone light on surface2", () => {
    focus.embedded = false;
    expect(resolveComposerPillHover(light)).toBe("#e6e7ed");
  });

  it("mixes any other CSS colour in the browser, as web Unistyles style sheets only see var() references", () => {
    expect(
      resolveComposerPillHover({
        colorScheme: "light",
        colors: {
          composerSurface: "var(--colors-composer-surface)",
          surface2: "var(--colors-surface2)",
          foreground: "var(--colors-foreground)",
        },
      }),
    ).toBe("color-mix(in srgb, var(--colors-composer-surface) 95%, var(--colors-foreground))");
  });

  it("keeps surface2 for dark and standalone builds whatever the colour format", () => {
    const vars = {
      composerSurface: "var(--colors-composer-surface)",
      surface2: "var(--colors-surface2)",
      foreground: "var(--colors-foreground)",
    };
    expect(resolveComposerPillHover({ colorScheme: "dark", colors: vars })).toBe(
      "var(--colors-surface2)",
    );
    focus.embedded = false;
    expect(resolveComposerPillHover({ colorScheme: "light", colors: vars })).toBe(
      "var(--colors-surface2)",
    );
  });
});

describe("chat fill (user message bubbles)", () => {
  beforeEach(() => {
    focus.embedded = true;
  });

  it("is the composer tone with a 1px inset ring in embedded light", () => {
    expect(
      resolveChatFillSurface({
        colorScheme: "light",
        colors: { composerSurface: "#dddfe5", surface3: "#cbcdd3" },
      }),
    ).toBe("#dddfe5");
    expect(resolveChatFillRing({ colorScheme: "light", colors: { borderAccent: "#c1c2c7" } })).toBe(
      "inset 0 0 0 1px #c1c2c7",
    );
  });

  it("keeps surface3 and no ring in dark and standalone builds", () => {
    const colors = { composerSurface: "#dddfe5", surface3: "#cbcdd3" };
    expect(resolveChatFillSurface({ colorScheme: "dark", colors })).toBe("#cbcdd3");
    expect(resolveChatFillRing({ colorScheme: "dark", colors: { borderAccent: "#2b3137" } })).toBe(
      "none",
    );
    focus.embedded = false;
    expect(resolveChatFillSurface({ colorScheme: "light", colors })).toBe("#cbcdd3");
    expect(resolveChatFillRing({ colorScheme: "light", colors: { borderAccent: "#c1c2c7" } })).toBe(
      "none",
    );
  });

  it("keeps the bubble text readable on it", () => {
    expect(ratio("#343b59", "#dddfe5")).toBeGreaterThanOrEqual(8);
    expect(ratio("#4c505e", "#dddfe5")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#c1c2c7", "#dddfe5")).toBeGreaterThanOrEqual(1.25);
  });
});

describe("composer theme tokens", () => {
  beforeEach(() => {
    focus.embedded = true;
  });

  it("are real values: dark is surface1 and surface2, embedded light the Details box tone and its hover", async () => {
    const { buildDarkSemanticColors, buildLightSemanticColors } = await import("@/styles/theme");
    const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");
    const lightColors = buildLightSemanticColors(
      resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]),
    );
    const darkColors = buildDarkSemanticColors(
      resolveDefaultDarkTint({} as Parameters<typeof resolveDefaultDarkTint>[0]),
    );
    expect(lightColors.composerSurface).toBe("#dddfe5");
    expect(lightColors.composerPillHover).toBe("#d5d7de");
    expect(lightColors.chatFillSurface).toBe("#dddfe5");
    expect(lightColors.chatFillRing).toBe("inset 0 0 0 1px #c1c2c7");
    // surface1, surface3 and the selected tone derived from them are untouched.
    expect(lightColors.surface1).toBe("#cbcdd3");
    expect(lightColors.surface3).toBe("#cbcdd3");
    expect(darkColors.composerSurface).toBe(darkColors.surface1);
    expect(darkColors.composerSurface).toBe("#2f363d");
    expect(darkColors.composerPillHover).toBe("#24292e");
    // Dark bubbles keep surface3 and have no ring.
    expect(darkColors.chatFillSurface).toBe(darkColors.surface3);
    expect(darkColors.chatFillRing).toBe("none");
  });

  it("give Chief's composer and pills the Details box tone too, keeping its raised bubbles", async () => {
    const { buildChiefColors, CHIEF_PALETTES } = await import("./chief-theme");
    const light = buildChiefColors("light");
    expect(light.composerSurface).toBe(CHIEF_PALETTES.light.composerSurface);
    expect(light.composerSurface).toBe("#dddfe5");
    expect(light.composerPillHover).toBe("#d5d7de");
    // The user bubbles follow the composer (tone and 1px ring); surface3 itself and raised cards stay #cbcdd3.
    expect(light.chatFillSurface).toBe("#dddfe5");
    expect(light.chatFillRing).toBe("inset 0 0 0 1px #c1c2c7");
    expect(light.surface1).toBe("#cbcdd3");
    expect(light.surface3).toBe("#cbcdd3");
    // The box sits on the #e6e7ed popup: lighter than the grey, darker than the popup, with a visible border.
    expect(luminance(light.composerSurface)).toBeLessThan(luminance(light.surface0));
    expect(ratio(light.border, light.composerSurface)).toBeGreaterThanOrEqual(1.25);
    expect(ratio(light.border, light.surface0)).toBeGreaterThanOrEqual(1.15);
    expect(ratio(light.foregroundMuted, light.composerSurface)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light.accent, light.composerSurface)).toBeGreaterThanOrEqual(4.5);
    // Dark keeps the raised tone and surface2.
    const dark = buildChiefColors("dark");
    expect(dark.composerSurface).toBe(dark.surface1);
    expect(dark.composerSurface).toBe("#2f363d");
    expect(dark.composerPillHover).toBe(dark.surface2);
    expect(dark.chatFillSurface).toBe(dark.surface3);
    expect(dark.chatFillRing).toBe("none");
  });

  it("are what the style sheets read, not values computed from the theme object", () => {
    const pills = readFileSync(resolve(__dirname, "../../composer/pill-styles.ts"), "utf8");
    expect(pills).toContain("backgroundColor: theme.colors.composerSurface");
    expect(pills).toContain("backgroundColor: theme.colors.composerPillHover");
    expect(pills).not.toContain("composer-pill-hover");
    const input = readFileSync(resolve(__dirname, "../../composer/input/input.tsx"), "utf8");
    const wrapper = input.slice(
      input.indexOf("  inputWrapper: {"),
      input.indexOf("  inputWrapperCompact: {"),
    );
    expect(wrapper).toContain("backgroundColor: theme.colors.composerSurface");
    expect(wrapper).not.toContain("backgroundColor: theme.colors.surface1");
  });

  it("are what the user bubble style sheet reads, leaving surface3 for every other user", () => {
    const source = readFileSync(resolve(__dirname, "../../components/message.tsx"), "utf8");
    const bubble = source.slice(source.indexOf("  bubble: {"), source.indexOf("  text: {"));
    expect(bubble).toContain("backgroundColor: theme.colors.chatFillSurface");
    expect(bubble).toContain("boxShadow: theme.colors.chatFillRing");
    expect(bubble).not.toContain("theme.colors.surface3");
  });

  it("reach the Run pill: the plugin composer button hovers with the pill style, not its own surface2 fill", () => {
    const source = readFileSync(resolve(__dirname, "../../plugins/buttons/view.tsx"), "utf8");
    expect(source).toContain("(input ? styles.inputActive : composerPillStyles.bodyActive)");
    expect(source).not.toContain("(input ? styles.inputActive : styles.active)");
  });
});
