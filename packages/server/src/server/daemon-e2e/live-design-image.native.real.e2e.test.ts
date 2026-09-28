import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";

import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const NONCE_PNG = readFileSync(
  new URL("./fixtures/live-design-nonce.png", import.meta.url),
).toString("base64");

test("a real Codex agent reads a nonce from PNG pixels sent through the daemon", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "paseo-live-design-image-"));
  const logger = pino({ level: "warn" });
  let daemon: Awaited<ReturnType<typeof createTestPaseoDaemon>> | undefined;
  let client: DaemonClient | undefined;
  try {
    daemon = await createTestPaseoDaemon({
      agentClients: { codex: new CodexAppServerAgentClient(logger) },
      logger,
      pluginsEnabled: false,
    });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    const agent = await client.createAgent({
      provider: "codex",
      cwd,
      ...(process.env.PASEO_LIVE_DESIGN_IMAGE_MODEL
        ? { model: process.env.PASEO_LIVE_DESIGN_IMAGE_MODEL }
        : {}),
      modeId: "auto",
      thinkingOptionId: "low",
    });
    await client.sendAgentMessage(
      agent.id,
      "Read the short identifier printed in the attached image. Reply only with that identifier. Do not use tools.",
      { images: [{ data: NONCE_PNG, mimeType: "image/png" }] },
    );
    const result = await client.waitForFinish(agent.id, 90_000);
    expect(result.status).toBe("idle");
    expect(result.final?.lastError).toBeUndefined();
    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 100,
      projection: "canonical",
    });
    const answer = timeline.entries
      .filter(({ item }) => item.type === "assistant_message")
      .map(({ item }) => (item.type === "assistant_message" ? item.text : ""))
      .join("\n");
    expect(answer).toContain("LD-7429");
    await client.deleteAgent(agent.id);
  } finally {
    await client?.close().catch(() => undefined);
    await daemon?.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 120_000);
