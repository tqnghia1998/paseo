import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientSlashCommand } from "@/client-slash-commands";
import { CLIENT_SLASH_COMMANDS } from "@/client-slash-commands";

const handshake = { requestRestart: vi.fn(), requestClose: vi.fn() };
vi.mock("./chief-host", () => ({ getChiefHandshake: () => handshake }));
import { runChiefSlashCommand } from "./chief-commands";

const command = (name: string): ClientSlashCommand =>
  CLIENT_SLASH_COMMANDS.find((candidate) => candidate.name === name)!;

describe("Chief slash commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("/clear and /new ask the host for a fresh conversation", () => {
    runChiefSlashCommand(command("clear"));
    expect(handshake.requestRestart).toHaveBeenCalledTimes(1);
    expect(handshake.requestClose).not.toHaveBeenCalled();
  });

  it("/exit closes the popup instead of archiving the one Chief agent", () => {
    runChiefSlashCommand(command("exit"));
    expect(handshake.requestClose).toHaveBeenCalledTimes(1);
    expect(handshake.requestRestart).not.toHaveBeenCalled();
  });

  it("answers to both names and their aliases", async () => {
    const { resolveClientSlashCommand } = await import("@/client-slash-commands");
    for (const text of ["/clear", "/new", "/exit", "/quit", "/q"])
      expect(resolveClientSlashCommand({ text, hasAttachments: false })).not.toBeNull();
  });

  it("is consulted before the agent panel's own archive path", () => {
    // Source guard: archiving is how an ordinary chat is cleared, and would end Chief.
    const panel = readFileSync(resolve(__dirname, "../../panels/agent-panel.tsx"), "utf8");
    const handler = panel.slice(panel.indexOf("const handleClientSlashCommand"));
    const chief = handler.indexOf("runChiefSlashCommand(command)");
    expect(chief).toBeGreaterThan(-1);
    expect(chief).toBeLessThan(handler.indexOf("await archiveAgent("));
    expect(handler.slice(0, chief)).toContain("isEmbeddedChiefView");
  });
});
