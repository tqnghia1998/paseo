import { request } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tls from "node:tls";
import { z } from "zod";
import {
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";
import { inputSchema } from "../shared/input.js";
import { ORIGIN, readCredentials } from "./credentials.js";

interface QuotaRequestOptions {
  headers: Record<string, string>;
  body: string;
}
type QuotaRequest = (
  url: URL,
  options: QuotaRequestOptions,
) => Promise<{ status: number; data: unknown }>;

const quotaSchema = z.object({
  retcode: z.literal(0),
  data: z.object({
    project_id: z.string(),
    selected_year: z.number().int(),
    selected_month: z.number().int().min(1).max(12),
    total_amount: z.number().finite().nonnegative(),
    usage: z.number().finite().nonnegative(),
    balance: z.number().finite(),
  }),
});

// Node's bundled roots alone do not include the corporate gateway's CA. Extend
// the runtime's default trust with OS roots for this request; keep verification on.
const systemTLS = tls as typeof tls & { getCACertificates?: (type: string) => string[] };
const requestQuota: QuotaRequest = (url, options) =>
  new Promise((resolve, reject) => {
    const ca = systemTLS.getCACertificates
      ? [...systemTLS.getCACertificates("default"), ...systemTLS.getCACertificates("system")]
      : undefined;
    const req = request(
      url,
      {
        method: "POST",
        headers: options.headers,
        ca,
        signal: AbortSignal.timeout(15_000),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            res.destroy(new Error("Quota response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          let data: unknown;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            data = null;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });

export async function discover(
  scope: UsageScope,
  lookup: { home?: string; binaryPath?: string } = {},
): Promise<UsageAccount[]> {
  if (scope.kind !== "global" || (!lookup.binaryPath && process.platform !== "darwin")) return [];
  const path = join(
    lookup.home ?? join(homedir(), ".ais-switch"),
    `google_oauth_auth.${hashAccountKey(ORIGIN)}.enc`,
  );
  const binaries = lookup.binaryPath
    ? [lookup.binaryPath]
    : [
        "/Applications/AIS Switch.app/Contents/MacOS/ais-switch",
        join(homedir(), "Applications/AIS Switch.app/Contents/MacOS/ais-switch"),
      ];
  for (const binaryPath of binaries) {
    const credentials = await readCredentials({ path, binaryPath });
    if (!credentials) continue;
    const key = hashAccountKey(`${ORIGIN}\0${credentials.account.user_id}`);
    return [
      {
        key,
        label: credentials.account.email,
        harness: "AIS Switch",
        input: { path, binaryPath, accountKey: key },
      },
    ];
  }
  return [];
}

export async function fetchUsage(
  input: unknown,
  requestApi: QuotaRequest = requestQuota,
  now = new Date(),
): Promise<UsageReport> {
  const parsed = inputSchema.parse(input);
  const credentials = await readCredentials(parsed);
  const missing = () =>
    unavailable({
      kind: "no_quota",
      detail: "Sign in or refresh quota in AIS Switch, then refresh Usage.",
    });
  if (!credentials) return missing();
  const { account } = credentials;
  if (hashAccountKey(`${ORIGIN}\0${account.user_id}`) !== parsed.accountKey) return missing();
  if (account.session_expires_at * 1000 <= now.getTime()) {
    return unavailable({
      kind: "expired",
      expiresAt: new Date(account.session_expires_at * 1000).toISOString(),
      refreshedBy: "AIS Switch",
    });
  }
  const cookie = account.cookies
    .map(({ raw_cookie }) => raw_cookie.split(";", 1)[0])
    .find((value) => /^CQP_SESSION=[^\s;\r\n]+$/.test(value ?? ""));
  if (!cookie) return missing();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let response;
  try {
    response = await requestApi(new URL("/compass-api/v1/cqp/ccswitch/monthly_usage", ORIGIN), {
      headers: { "Content-Type": "application/json", Cookie: cookie, "X-CQP-Auth": "1" },
      body: JSON.stringify({
        project_id: account.project_id,
        selected_year: year,
        selected_month: month,
      }),
    });
  } catch {
    return {
      status: "error",
      error: "AIS Switch quota request failed. Check gateway connectivity.",
    };
  }
  if (response.status === 401 || response.status === 403) {
    return unavailable({ kind: "rejected", status: response.status, refreshedBy: "AIS Switch" });
  }
  const quota = quotaSchema.safeParse(response.data);
  if (response.status !== 200 || !quota.success)
    return { status: "error", error: "AIS Switch returned an invalid quota response." };
  const data = quota.data.data;
  if (
    data.project_id !== account.project_id ||
    data.selected_year !== year ||
    data.selected_month !== month
  ) {
    return {
      status: "error",
      error: "AIS Switch returned quota for a different project or month.",
    };
  }
  if (!data.total_amount)
    return unavailable({
      kind: "no_quota",
      detail: "This AIS account has no monthly AQP allowance.",
    });
  const usedPct = Math.min(100, (data.usage / data.total_amount) * 100);
  const remainingPct = Math.max(0, Math.min(100, (data.balance / data.total_amount) * 100));
  return {
    status: "available",
    planLabel: "AQP",
    windows: [
      {
        ...windowFromUsedPct({
          id: "spending_allowance",
          label: "Monthly AQP",
          shortLabel: "AQP",
          summary: true,
          utilizationPct: usedPct,
          tone: toneFromUsedPct(usedPct),
        }),
        remainingPct,
      },
    ],
    balances: [
      {
        id: "spending",
        label: "Monthly AQP",
        used: data.usage,
        remaining: data.balance,
        limit: data.total_amount,
        unit: "usd",
      },
    ],
  };
}
