import { randomUUID } from "node:crypto";
import { z } from "zod";

const identity = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) =>
      [...value].every(
        (character) => character.codePointAt(0)! >= 32 && character.codePointAt(0) !== 127,
      ),
    );
export const Identity = identity(128);
export const WorkspaceIdentity = identity(255);
/** Git-ref-safe branch names: no spaces, control characters, `..`, leading `-` or `~^:?*[\`. */
export const BranchName = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !value.startsWith("-") &&
      !value.includes("..") &&
      value !== "@" &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock") &&
      !value.includes("//") &&
      !value.includes("@{") &&
      [...value].every((character) => {
        const code = character.codePointAt(0)!;
        return code > 32 && code !== 127 && !"~^:?*[\\".includes(character);
      }),
    "Invalid branch name",
  );
export const MergeRequestUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Expected an https merge request URL");
const Workspace = z
  .object({
    id: WorkspaceIdentity,
    name: z.string().min(1).max(255),
    cwd: z.string().min(1).max(4096).optional(),
  })
  .strict();
const Inventory = z
  .object({
    apps: z
      .array(
        z
          .object({
            id: Identity,
            name: z.string().min(1).max(200),
            gitRepo: z.string().max(2048),
            workspaces: z.array(Workspace).max(256),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();
export const NavigationInput = z
  .object({
    appId: Identity,
    workspaceId: WorkspaceIdentity,
    destination: z.enum(["web", "bots", "vscode"]),
  })
  .strict();
export const OpenBranchInput = z
  .object({
    appId: Identity,
    branch: BranchName,
    targetBranch: BranchName.optional(),
  })
  .strict();

const MergeRequest = z
  .object({
    provider: z.enum(["gitlab", "github"]),
    url: MergeRequestUrl,
    number: z.number().int().positive(),
    title: z.string().max(300),
    state: z.enum(["open", "closed", "merged"]),
    sourceBranch: BranchName,
    targetBranch: BranchName,
    sourceRepository: z.string().min(1).max(2048),
    targetRepository: z.string().min(1).max(2048),
    crossRepository: z.boolean(),
  })
  .strict();
export type ChiefMergeRequest = z.infer<typeof MergeRequest>;
const AppMatch = z
  .object({
    appId: Identity,
    name: z.string().min(1).max(200),
    workspaceId: WorkspaceIdentity.optional(),
  })
  .strict();
export type ChiefAppMatch = z.infer<typeof AppMatch>;

const NavigateAck = z.object({ outcome: z.enum(["opened", "unavailable"]) }).strict();
const OpenBranchAck = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("opened"), workspaceId: WorkspaceIdentity }).strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      reason: z.enum(["unknown-app", "failed"]),
    })
    .strict(),
]);
const ResolveAck = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("resolved"),
      mergeRequest: MergeRequest,
      apps: z.array(AppMatch).max(128),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      reason: z.enum(["unsupported-url", "not-found", "no-access", "failed"]),
    })
    .strict(),
]);

export type ChiefHostRequest =
  | ({ id: string; kind: "navigate" } & z.infer<typeof NavigationInput>)
  | { id: string; kind: "resolve-merge-request"; url: string }
  | ({ id: string; kind: "open-branch" } & z.infer<typeof OpenBranchInput>);
interface Unknown {
  outcome: "unknown";
}
export type NavigationOutcome = { outcome: "opened" | "unavailable" } | Unknown;
export type OpenBranchOutcome = z.infer<typeof OpenBranchAck> | Unknown;
export interface ChiefResolution {
  resolutionId: string;
  mergeRequest: ChiefMergeRequest;
  apps: ChiefAppMatch[];
}
export type ResolveOutcome =
  | ({ outcome: "resolved" } & ChiefResolution)
  | Extract<z.infer<typeof ResolveAck>, { outcome: "unavailable" }>
  | Unknown;

const TIMEOUTS: Record<ChiefHostRequest["kind"], number> = {
  navigate: 30_000,
  "resolve-merge-request": 30_000,
  // Opening a branch may clone the repository first.
  "open-branch": 5 * 60_000,
};
const RESOLUTION_TTL = 30 * 60_000;
const MAX_RESOLUTIONS = 64;

export function createChiefTools() {
  let apps: z.infer<typeof Inventory>["apps"] = [];
  let closed = false;
  const inventoryListeners = new Set<() => void>();
  const pending = new Map<
    string,
    {
      request: ChiefHostRequest;
      delivered: boolean;
      settle(body: unknown): void;
      resolve(outcome: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const resolutions = new Map<string, ChiefResolution & { expires: number }>();
  const hasApp = (appId: string) => apps.some((app) => app.id === appId);
  const hasWorkspace = (appId: string, workspaceId: string) =>
    apps.some(
      (app) => app.id === appId && app.workspaces.some((workspace) => workspace.id === workspaceId),
    );
  // A request whose target left the inventory resolves as unavailable.
  function invalidOutcome(request: ChiefHostRequest): unknown {
    if (request.kind === "navigate" && !hasWorkspace(request.appId, request.workspaceId))
      return { outcome: "unavailable" };
    if (request.kind === "open-branch" && !hasApp(request.appId))
      return { outcome: "unavailable", reason: "unknown-app" };
    return null;
  }
  function finish(id: string, outcome: unknown) {
    const entry = pending.get(id);
    if (!entry) throw new Error("Unknown navigation request");
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(outcome);
  }
  function enqueue<T>(
    request: ChiefHostRequest,
    settle: (body: unknown, resolve: (outcome: T) => void) => void,
  ): Promise<T> {
    if (closed) throw new Error("Chief navigation stopped");
    if (pending.size >= 8) throw new Error("Navigation capacity reached");
    return new Promise<T>((resolve) => {
      const timer = setTimeout(
        () => finish(request.id, { outcome: "unknown" }),
        TIMEOUTS[request.kind],
      );
      timer.unref?.();
      pending.set(request.id, {
        request,
        delivered: false,
        resolve: resolve as (outcome: unknown) => void,
        settle: (body) => settle(body, (outcome) => finish(request.id, outcome)),
        timer,
      });
    });
  }
  function pruneResolutions() {
    const now = Date.now();
    for (const [id, entry] of resolutions) if (entry.expires <= now) resolutions.delete(id);
  }
  function updateInventory(input: unknown) {
    const next = Inventory.parse(input).apps;
    if (next.reduce((count, app) => count + app.workspaces.length, 0) > 5000)
      throw new Error("Inventory capacity reached");
    if (new Set(next.map((app) => app.id)).size !== next.length)
      throw new Error("Duplicate app identity");
    for (const app of next) {
      if (new Set(app.workspaces.map((workspace) => workspace.id)).size !== app.workspaces.length)
        throw new Error("Duplicate workspace identity");
      if (/^[a-z]+:\/\//i.test(app.gitRepo)) {
        const url = new URL(app.gitRepo);
        if (url.password || (url.username && url.username !== "git") || url.search || url.hash)
          throw new Error("Unsafe repository identity");
      }
    }
    apps = next;
    for (const [id, entry] of pending) {
      const outcome = invalidOutcome(entry.request);
      if (outcome) finish(id, outcome);
    }
    notifyInventory();
  }
  function store(mergeRequest: ChiefMergeRequest, matches: ChiefAppMatch[]): ResolveOutcome {
    pruneResolutions();
    while (resolutions.size >= MAX_RESOLUTIONS)
      resolutions.delete(resolutions.keys().next().value!);
    const resolution: ChiefResolution = {
      resolutionId: randomUUID(),
      mergeRequest,
      apps: matches,
    };
    resolutions.set(resolution.resolutionId, {
      ...structuredClone(resolution),
      expires: Date.now() + RESOLUTION_TTL,
    });
    return { outcome: "resolved", ...resolution };
  }
  /** Resolves on the next inventory update (or close), or after the timeout. */
  function inventoryUpdate(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => inventoryListeners.delete(resolve) && resolve(), timeoutMs);
      timer.unref?.();
      inventoryListeners.add(resolve);
    });
  }
  function notifyInventory() {
    const listeners = [...inventoryListeners];
    inventoryListeners.clear();
    for (const listener of listeners) listener();
  }
  function findWorkspace(appId: string, workspaceId: string) {
    return apps
      .find((app) => app.id === appId)
      ?.workspaces.find((entry) => entry.id === workspaceId);
  }
  return {
    updateInventory,
    listApps: () => apps.map(({ id, name, gitRepo }) => ({ id, name, gitRepo })),
    hasApp,
    listWorkspaces(appId: string) {
      const app = apps.find((candidate) => candidate.id === appId);
      if (!app) throw new Error("Unknown app");
      return app.workspaces.map(({ id, name }) => ({ id, name }));
    },
    /**
     * The workspace's checkout directory. A workspace the host just opened reaches the
     * inventory on its next poll, so wait briefly for it.
     */
    async workspaceDirectory(appId: string, workspaceId: string, waitMs = 0) {
      const deadline = Date.now() + waitMs;
      for (;;) {
        const workspace = findWorkspace(appId, workspaceId);
        if (workspace?.cwd)
          return {
            cwd: workspace.cwd,
            name: workspace.name,
            gitRepo: apps.find((app) => app.id === appId)!.gitRepo,
          };
        const remaining = deadline - Date.now();
        if (remaining <= 0 || closed) throw new Error("Feature workspace is not available on disk");
        await inventoryUpdate(remaining);
      }
    },
    openWorkspace(input: unknown): Promise<NavigationOutcome> {
      const target = NavigationInput.parse(input);
      if (!hasWorkspace(target.appId, target.workspaceId)) throw new Error("Unknown workspace");
      return enqueue<NavigationOutcome>(
        { id: randomUUID(), kind: "navigate", ...target },
        (body, resolve) => {
          const { outcome } = NavigateAck.parse(body);
          resolve({
            outcome: hasWorkspace(target.appId, target.workspaceId) ? outcome : "unavailable",
          });
        },
      );
    },
    openBranch(input: unknown): Promise<OpenBranchOutcome> {
      const target = OpenBranchInput.parse(input);
      if (!hasApp(target.appId)) throw new Error("Unknown app");
      return enqueue<OpenBranchOutcome>(
        { id: randomUUID(), kind: "open-branch", ...target },
        (body, resolve) => resolve(OpenBranchAck.parse(body)),
      );
    },
    resolveMergeRequest(url: unknown): Promise<ResolveOutcome> {
      const parsed = MergeRequestUrl.parse(url);
      return enqueue<ResolveOutcome>(
        { id: randomUUID(), kind: "resolve-merge-request", url: parsed },
        (body, resolve) => {
          const ack = ResolveAck.parse(body);
          if (ack.outcome === "unavailable") resolve(ack);
          else resolve(store(ack.mergeRequest, ack.apps));
        },
      );
    },
    /** A stored merge request resolution, for 30 minutes after it resolved. */
    resolution(id: string): ChiefResolution | null {
      pruneResolutions();
      const entry = resolutions.get(id);
      if (!entry) return null;
      const { expires: _expires, ...resolution } = entry;
      return structuredClone(resolution);
    },
    poll(input: unknown): ChiefHostRequest[] {
      updateInventory(input);
      const requests: ChiefHostRequest[] = [];
      for (const entry of pending.values()) {
        if (entry.delivered) continue;
        entry.delivered = true;
        requests.push({ ...entry.request });
        break;
      }
      return requests;
    },
    ack(id: string, input: unknown) {
      const entry = pending.get(id);
      if (!entry?.delivered) throw new Error("Unknown navigation request");
      entry.settle(input);
    },
    /** A new conversation: requests the old one was waiting on are answered unknown. */
    reset() {
      for (const id of pending.keys()) finish(id, { outcome: "unknown" });
    },
    close() {
      closed = true;
      for (const id of pending.keys()) finish(id, { outcome: "unknown" });
      notifyInventory();
    },
  };
}
