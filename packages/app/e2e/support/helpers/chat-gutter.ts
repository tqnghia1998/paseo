import { expect, type Page } from "@playwright/test";

const embedded = process.env.EXPO_PUBLIC_PASEO_EMBEDDED_FOCUS === "true";

export async function resizeChatPane(page: Page, width: number): Promise<void> {
  const transcript = page.getByTestId("agent-chat-scroll").filter({ visible: true }).first();
  await expect(transcript).toBeVisible();
  const paneWidth = await transcript.evaluate((element) => element.clientWidth);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Expected a browser viewport");
  await page.setViewportSize({ width: viewport.width + width - paneWidth, height: 900 });
  await expect.poll(() => transcript.evaluate((element) => element.clientWidth)).toBe(width);
}

export async function expectChatGutter(page: Page, width: number): Promise<void> {
  const transcript = page.getByTestId("agent-chat-scroll").filter({ visible: true }).first();
  const content = transcript.locator(":scope > div").first();
  const gutter = embedded && width >= 960 ? 96 : 16;
  await expect(content).toHaveCSS("padding-left", `${gutter}px`);
  await expect(content).toHaveCSS("padding-right", `${gutter}px`);
  const rail = page.getByTestId("chat-outline-rail");
  if (width >= (embedded ? 960 : 918)) {
    await expect(rail).toBeVisible();
  } else {
    await expect(rail).toBeHidden();
  }
  const message = transcript.getByTestId("user-message").last();
  await expect(message).toBeVisible();
  const footer = transcript.getByRole("button", { name: "Copy turn", exact: true }).last();
  await expect(footer).toBeVisible();
  const composer = page.getByTestId("message-input-root").filter({ visible: true }).first();
  await expect(composer).toBeVisible();
  const pane = await transcript.boundingBox();
  if (!pane) throw new Error("Expected a measured transcript");
  for (const element of [message, footer, composer]) {
    const box = await element.boundingBox();
    if (!box) throw new Error("Expected a measured chat element");
    expect(box.x).toBeGreaterThanOrEqual(pane.x + gutter - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width - gutter + 1);
  }
  const input = await composer.boundingBox();
  if (!input) throw new Error("Expected a measured composer");
  expect(input.width).toBeLessThanOrEqual(embedded ? 960 : 820);
  expect(Math.abs(input.x + input.width / 2 - pane.x - pane.width / 2)).toBeLessThanOrEqual(1);
}
