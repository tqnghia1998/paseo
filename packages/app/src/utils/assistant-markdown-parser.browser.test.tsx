import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Markdown from "react-native-markdown-display";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it.each([390, 1200])("renders unresolved citations cleanly at %ipx", async (width) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await page.viewport(width, 700);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onLinkPress = vi.fn(() => false);
  const citation = "\uE200cite\uE202turn511321view1\uE202turn446758search3\uE201";
  const text = `What Is Langfuse?\n\nAI tracing records model calls.${citation}\n\n- Frontend monitoring captures errors.${citation}\n- AI tracing records intermediate steps.${citation}\n\n[APMS integration](https://example.com/apms)`;
  await act(async () =>
    root?.render(
      <Markdown markdownit={createAssistantMarkdownParser()} onLinkPress={onLinkPress}>
        {text}
      </Markdown>,
    ),
  );
  expect(container.textContent).not.toMatch(/[\uE200-\uE202]|turn\d+/);
  expect(container.textContent?.match(/\[source unavailable\]/g)).toHaveLength(3);
  await page.getByText("APMS integration", { exact: true }).click();
  expect(onLinkPress).toHaveBeenCalledWith("https://example.com/apms");
  expect(container.scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot();
});
