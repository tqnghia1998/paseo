import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { ToolCallDetailsContent } from "./tool-call-details";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

const INTERACTIVE_SHELL: ToolCallDetail = {
  type: "shell",
  command: "git add -p ui/sharing.jsx",
  output: "diff --git a/ui/sharing.jsx b/ui/sharing.jsx\nStage this hunk?",
  stdin: "s\ny\nn\ny\nd\n",
};

vi.mock("react-native-unistyles", async () => {
  const { darkTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (factory: (theme: typeof darkTheme) => unknown) => factory(darkTheme),
    },
  };
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it.each([390, 1200])("renders shell input separately from output at %ipx", async (width) => {
  await page.viewport(width, 700);
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: { toolCallDetails: { input: "Input", output: "Output" } } } },
  });
  container = document.createElement("div");
  container.style.backgroundColor = "#1a1a1a";
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <I18nextProvider i18n={i18n}>
        <ToolCallDetailsContent detail={INTERACTIVE_SHELL} />
      </I18nextProvider>,
    ),
  );
  expect(container.textContent).toContain("$ git add -p ui/sharing.jsx");
  expect(container.textContent).toContain("Stage this hunk?");
  expect(container.textContent).toContain("Input\ns\ny\nn\ny\nd\n");
  expect(container.scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot();
});
