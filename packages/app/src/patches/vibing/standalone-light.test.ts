import { describe, expect, it, vi } from "vitest";

// Outside the embedded build (standalone Paseo, any non-Space theme) the light builder must give exactly what upstream's
// does: the role mapping, the destructive colour and the status dots are untouched, and a `selected` colour never alters them.
vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: false, isEmbeddedChiefView: false }));

const { resolveLightRoles } = await import("./default-dark-tint");
const { buildDarkSemanticColors, buildLightSemanticColors } = await import("@/styles/theme");

const UPSTREAM_ROLES = {
  surfaceSidebarHover: "#e4e4e7",
  surfaceSidebarSelected: "#d4d4d8",
  surfaceWorkspace: "#ffffff",
  destructiveForeground: "#ffffff",
  successForeground: "#ffffff",
};

const TINT = {
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  surface3: "#e4e4e7",
  surface4: "#d4d4d8",
  surfaceDiffEmpty: "#f6f6f6",
  surfaceSidebar: "#f4f4f5",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  foregroundExtraMuted: "#a1a1aa",
  border: "#e4e4e7",
  borderAccent: "#ececf1",
  accent: "#20744A",
  accentBright: "#239956",
  accentForeground: "#ffffff",
  primary: "#18181b",
  primaryForeground: "#fafafa",
  destructive: "#b04138",
  terminalBlack: "#1a1a1e",
  terminalBrightBlack: "#3f3f46",
  ring: "#18181b",
};

describe("standalone light and dark builders", () => {
  const tint = TINT as Parameters<typeof buildLightSemanticColors>[0];

  it("returns upstream's four role colours untouched", () => {
    expect(resolveLightRoles(tint, UPSTREAM_ROLES)).toBe(UPSTREAM_ROLES);
  });

  it("keeps upstream's role mapping, destructive colour and status dots", () => {
    const colors = buildLightSemanticColors(tint);
    expect(colors.surfaceSidebarHover).toBe(TINT.surface3);
    expect(colors.surfaceSidebarSelected).toBe(TINT.surface4);
    expect(colors.surfaceWorkspace).toBe(TINT.surface0);
    expect(colors.destructive).toBe("#b04138");
    expect(colors.destructiveForeground).toBe(TINT.surface0);
    expect(colors.successForeground).toBe(TINT.surface0);
    expect([
      colors.statusDotRunning,
      colors.statusDotSuccess,
      colors.statusDotWarning,
      colors.statusDotDanger,
    ]).toEqual(["#268ae0", "#299f51", "#b37824", "#f12e2f"]);
  });

  it("does not let a selected colour change the standalone theme", () => {
    const plain = buildLightSemanticColors(tint);
    const withSelected = buildLightSemanticColors({ ...tint, selected: "#444d56" });
    const { selected, ...rest } = withSelected as typeof withSelected & { selected?: string };
    expect(selected).toBe("#444d56");
    expect(rest).toEqual(plain);
  });

  it("has no selected key without a selected tone (the Bots plugin reads its presence)", () => {
    expect("selected" in buildLightSemanticColors(tint)).toBe(false);
    expect("selected" in buildDarkSemanticColors({ ...tint, popover: undefined })).toBe(false);
  });
});
