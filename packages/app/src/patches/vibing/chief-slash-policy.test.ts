import { describe, expect, it, vi } from "vitest";
import { isChiefSlashCommandAllowed, rejectChiefSlashCommand } from "./chief-slash-policy";

describe("Chief /btw policy", () => {
  it("hides only btw in Chief, including a provider or plugin offering the same name", () => {
    const commands = [{ name: "btw" }, { name: "clear" }, { name: "side" }];
    expect(commands.filter((c) => isChiefSlashCommandAllowed(c.name, true))).toEqual([
      { name: "clear" },
      { name: "side" },
    ]);
    expect(commands.filter((c) => isChiefSlashCommandAllowed(c.name, false))).toEqual(commands);
  });

  it.each(["/btw", " /btw why? ", "/btw\nwhy?", "/BTW why?"])(
    "rejects a directly typed Chief command before dispatch: %s",
    (text) => {
      const showError = vi.fn();
      expect(rejectChiefSlashCommand(text, showError, true)).toBe(true);
      expect(showError).toHaveBeenCalledWith(
        "/btw is disabled in Chief. Use a Bot chat for side questions.",
      );
    },
  );

  it.each(["/btw why?", "/btw"])("keeps Bot dispatch available: %s", (text) => {
    const showError = vi.fn();
    expect(rejectChiefSlashCommand(text, showError, false)).toBe(false);
    expect(showError).not.toHaveBeenCalled();
  });

  it.each(["Explain /btw", "/btw.md", "/btw-more", "/clear", "/side investigate"])(
    "leaves other Chief messages alone: %s",
    (text) => {
      const showError = vi.fn();
      expect(rejectChiefSlashCommand(text, showError, true)).toBe(false);
      expect(showError).not.toHaveBeenCalled();
    },
  );
});
