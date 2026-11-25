import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Text, View } from "react-native";
import { expect, it, vi } from "vitest";
import { MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { ComposerDiffStatPill } from "./diff-stat-pill";
import { composerPillStyles } from "./pill-styles";

const rowStyle = { flexDirection: "row", alignItems: "center" } as const;
const onPress = () => {};

vi.mock("@/patches/vibing/focus-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/patches/vibing/focus-mode")>()),
  isEmbeddedFocusMode: true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("aligns a composer menu trigger with the Changes pill without Chat Polish", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(
        <View style={rowStyle}>
          <MenuRoot>
            <MenuTrigger testID="run" style={composerPillStyles.body}>
              <Text style={composerPillStyles.label}>Run</Text>
            </MenuTrigger>
          </MenuRoot>
          <ComposerDiffStatPill additions={231} deletions={10} onPress={onPress} />
        </View>,
      ),
    );

    const run = container.querySelector('[data-testid="run"]')?.getBoundingClientRect();
    const changes = container
      .querySelector('[data-testid="composer-diff-stat-pill"]')
      ?.getBoundingClientRect();
    expect(run?.height).toBe(24);
    expect(changes?.height).toBe(24);
    expect(run?.top).toBe(changes?.top);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
