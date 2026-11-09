import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("vendored Side Chat loads and serves empty status without starting an agent", async () => {
  const daemon = await createTestPaseoDaemon({ daemonVersion: "0.15.3" });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.15.3",
  });
  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
      "plugins/paseo-sidechat",
    );
    const installed = await client.installDirectoryPlugin(directory);
    expect(installed).toMatchObject({ id: "paseo-sidechat", enabled: true, status: "running" });
    await expect(
      client.invokePluginRpc("paseo-sidechat", "sidechat.status", {
        agentId: "isolated-sidechat-test",
      }),
    ).resolves.toEqual({ questions: [], openThreads: [] });
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);
