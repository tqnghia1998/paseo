import { describe, expect, it, vi } from "vitest";

vi.mock("./focus-mode", () => ({ isEmbeddedFocusMode: true }));

const { resolveDefaultDarkTint, resolveDefaultLightTint } = await import("./default-dark-tint");

describe("Space App Vibing default tints", () => {
  it("gives borders their own value and keeps surface3 on the hover tone", () => {
    const dark = resolveDefaultDarkTint({} as Parameters<typeof resolveDefaultDarkTint>[0]);
    expect(dark).toMatchObject({
      border: "#2b3137",
      borderAccent: "#2b3137",
      surface1: "#2f363d",
      surface3: "#2f363d",
    });
    const light = resolveDefaultLightTint({} as Parameters<typeof resolveDefaultLightTint>[0]);
    expect(light).toMatchObject({
      border: "#e1e4e8",
      borderAccent: "#e1e4e8",
      surface1: "#f6f8fa",
      surface3: "#f6f8fa",
    });
  });
});
