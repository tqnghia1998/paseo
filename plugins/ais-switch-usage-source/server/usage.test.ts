import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { hashAccountKey } from "@getpaseo/plugin/server/usage";
import { inputSchema } from "../shared/input.js";
import { discover, fetchUsage } from "./usage.js";
import { ORIGIN, readCredentials } from "./credentials.js";

let home: string;
let binaryPath: string;
let path: string;
let key: Buffer;
const now = new Date("2026-10-21T10:00:00Z");
const accountKey = hashAccountKey("https://compass.llm.shopee.io\0fixture-user");
const account = () => ({
  user_id: "fixture-user",
  email: "fixture@example.test",
  project_id: "fixture-project",
  session_expires_at: now.getTime() / 1000 + 3600,
  cookies: [
    {
      raw_cookie: "CQP_SESSION=fixture-session; Secure; HttpOnly",
      domain: { HostOnly: "compass.llm.shopee.io" },
      path: ["/", true],
    },
  ],
  gateway_key: "fixture-model-key-never-send",
});

async function writeCredentials(changes: Partial<ReturnType<typeof account>> = {}) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`AIS Switch CQP credentials v1\0${ORIGIN}`));
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({ version: 1, origin: ORIGIN, account: { ...account(), ...changes } }),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  await writeFile(path, Buffer.concat([Buffer.from("AISCQP\x01\x00"), nonce, encrypted]));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "usage-ais-"));
  path = join(home, `google_oauth_auth.${hashAccountKey(ORIGIN)}.enc`);
  binaryPath = join(home, "ais-switch");
  key = randomBytes(32);
  // The installed app's format descriptor precedes the encryption key.
  await writeFile(
    binaryPath,
    Buffer.concat([
      Buffer.alloc(65520),
      Buffer.from("AIS Switch CQP credentials v1\0\xc0\0", "latin1"),
      key,
    ]),
  );
  await writeCredentials();
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const input = () => ({ path, binaryPath, accountKey });
const quota = (changes = {}) => ({
  retcode: 0,
  data: {
    project_id: "fixture-project",
    selected_year: 2026,
    selected_month: 10,
    total_amount: 1000,
    usage: 619,
    balance: 381,
    plan: "AQP",
    ...changes,
  },
});
const response =
  (data: unknown = quota(), status = 200) =>
  async () => ({ status, data });

test("discovers one global account with locators and a hashed identity, never credentials", async () => {
  const accounts = await discover({ kind: "global" }, { home, binaryPath });
  expect(accounts).toEqual([
    { key: accountKey, label: "fixture@example.test", harness: "AIS Switch", input: input() },
  ]);
  expect(JSON.stringify(accounts)).not.toContain("fixture-session");
  expect(JSON.stringify(accounts)).not.toContain("fixture-model-key");
  expect(
    await discover({ kind: "session", provider: "codex", env: {} }, { home, binaryPath }),
  ).toEqual([]);
  expect(inputSchema.safeParse({ ...input(), cookie: "secret" }).success).toBe(false);
});

test("reads the authenticated disk envelope without changing it", async () => {
  const before = await readFile(path);
  expect(await readCredentials(input())).toMatchObject({ account: { user_id: "fixture-user" } });
  expect(await readFile(path)).toEqual(before);
});

test("posts the current month with only the session cookie to the fixed quota endpoint", async () => {
  const request = vi.fn(async () => ({ status: 200, data: quota() }));
  const report = await fetchUsage(input(), request, now);
  const [url, options] = request.mock.calls[0]! as unknown as [
    URL,
    { headers: Record<string, string>; body: string },
  ];
  expect(url.href).toBe(`${ORIGIN}/compass-api/v1/cqp/ccswitch/monthly_usage`);
  expect(options.headers).toMatchObject({
    Cookie: "CQP_SESSION=fixture-session",
    "X-CQP-Auth": "1",
  });
  expect(options.body).toBe(
    JSON.stringify({ project_id: "fixture-project", selected_year: 2026, selected_month: 10 }),
  );
  expect(JSON.stringify(options)).not.toContain("fixture-model-key");
  expect(report).toMatchObject({
    status: "available",
    planLabel: "AQP",
    windows: [{ id: "spending_allowance", usedPct: 61.9, remainingPct: 38.1, resetsAt: null }],
    balances: [{ id: "spending", used: 619, remaining: 381, limit: 1000, unit: "usd" }],
  });
});

test("rereads rotated credentials and refuses a different signed-in account", async () => {
  await writeCredentials({
    cookies: [
      {
        raw_cookie: "CQP_SESSION=fixture-rotated",
        domain: { HostOnly: "compass.llm.shopee.io" },
        path: ["/", true],
      },
    ],
  });
  const request = vi.fn(response());
  await fetchUsage(input(), request, now);
  expect(JSON.stringify(request.mock.calls)).toContain("fixture-rotated");
  await writeCredentials({ user_id: "different-user" });
  request.mockClear();
  expect(await fetchUsage(input(), request, now)).toMatchObject({ status: "unavailable" });
  expect(request).not.toHaveBeenCalled();
});

test("reports expired sessions and never refreshes them", async () => {
  await writeCredentials({ session_expires_at: now.getTime() / 1000 - 1 });
  const request = vi.fn(response());
  expect(await fetchUsage(input(), request, now)).toMatchObject({
    status: "unavailable",
    problem: { kind: "expired", refreshedBy: "AIS Switch" },
  });
  expect(request).not.toHaveBeenCalled();
});

test.each([401, 403])(
  "reports a rejected session (%s) without exposing response data",
  async (status) => {
    expect(
      await fetchUsage(input(), response({ secret: "never echo" }, status), now),
    ).toMatchObject({
      status: "unavailable",
      problem: { kind: "rejected", status, refreshedBy: "AIS Switch" },
    });
  },
);

test.each([302, 500])("reports HTTP failure (%s)", async (status) => {
  expect(await fetchUsage(input(), response({}, status), now)).toMatchObject({ status: "error" });
});

test.each([
  quota({ balance: null }),
  quota({ project_id: "other" }),
  quota({ selected_month: 9 }),
  { retcode: 1, data: quota().data },
])("rejects malformed, stale or wrong-project quota", async (data) => {
  expect(await fetchUsage(input(), response(data), now)).toMatchObject({ status: "error" });
});

test("does not invent a budget for a zero allowance", async () => {
  expect(await fetchUsage(input(), response(quota({ total_amount: 0 })), now)).toMatchObject({
    status: "unavailable",
    problem: { kind: "no_quota" },
  });
});

test("preserves reported overages and clamps only the display percentage", async () => {
  expect(
    await fetchUsage(input(), response(quota({ usage: 1100, balance: -100 })), now),
  ).toMatchObject({
    status: "available",
    windows: [{ usedPct: 100, remainingPct: 0, tone: "danger" }],
    balances: [{ used: 1100, remaining: -100 }],
  });
});

test("missing or corrupted credentials cannot trigger a quota request", async () => {
  const request = vi.fn(response());
  await writeFile(path, Buffer.alloc(40));
  expect(await discover({ kind: "global" }, { home, binaryPath })).toEqual([]);
  expect(await fetchUsage(input(), request, now)).toMatchObject({ status: "unavailable" });
  await rm(path);
  expect(await fetchUsage(input(), request, now)).toMatchObject({ status: "unavailable" });
  expect(request).not.toHaveBeenCalled();
});

test("authentication rejects modified ciphertext and foreign cookies", async () => {
  const data = await readFile(path);
  data[data.length - 1]! ^= 1;
  await writeFile(path, data);
  expect(await readCredentials(input())).toBeNull();
  await writeCredentials({
    cookies: [
      {
        raw_cookie: "CQP_SESSION=foreign",
        domain: { HostOnly: "elsewhere.test" },
        path: ["/", true],
      },
    ],
  });
  expect(await fetchUsage(input(), response(), now)).toMatchObject({ status: "unavailable" });
});

test("a changed AIS executable format fails closed", async () => {
  await writeFile(binaryPath, Buffer.from("unsupported AIS format"));
  expect(await readCredentials(input())).toBeNull();
  expect(await discover({ kind: "global" }, { home, binaryPath })).toEqual([]);
});

test("network errors cannot leak credentials through the report", async () => {
  const request = async () => {
    throw new Error("fixture-session: internal network failure");
  };
  const report = await fetchUsage(input(), request, now);
  expect(report).toMatchObject({ status: "error" });
  expect(JSON.stringify(report)).not.toContain("fixture-session");
});
