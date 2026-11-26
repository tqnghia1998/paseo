import { type ChildProcess, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fsPromises from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pLimit from "p-limit";
import { ZodError } from "zod";
import type * as build from "./compiler-build.js";
import type { PluginManifest } from "./manifest.js";
import type { CompilerReply } from "./compiler-worker.js";

export {
  SERVER_HOST_MODULES,
  resolveExistingAsarUnpackedEsbuildBinary,
  unpackedEsbuildBinaryFromPackageDir,
} from "./compiler-esbuild.js";

export type CompilerTask =
  | { kind: "entries"; entries: Parameters<typeof build.compilePlugin>[0] }
  | { kind: "directory"; directory: string; version: string; builtinId?: string }
  | {
      kind: "prepare";
      directory: string;
      commands: PluginManifest["build"];
      environment: NodeJS.ProcessEnv;
    };

interface TaskResult {
  entries: Awaited<ReturnType<typeof build.compilePlugin>>;
  directory: Awaited<ReturnType<typeof build.compileDirectoryPlugin>>;
  prepare: void;
}

const IDLE_TIMEOUT_MS = 1_000;
const COMPILER_POOL_SIZE = 2;
export const DEFAULT_COMPILE_CACHE_DIR = path.join(os.tmpdir(), "paseo-v8-compile-cache");
const SHARED_PLUGIN_COMPILE_CACHE_DIR = path.join(os.tmpdir(), "paseo-plugin-compile-cache-v1");
const PLUGIN_COMPILE_CACHE_SCHEMA = "v1";
const source = import.meta.url.endsWith(".ts");
const workerUrl = new URL(
  source ? "./compiler-worker.ts" : "./compiler-worker.js",
  import.meta.url,
);
const workerExecArgv = source
  ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]
  : [];

interface CompilerProcess {
  child: ChildProcess;
  exited: Promise<void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  retired: boolean;
}

// Reuse a small pool of processes during a build batch, then release TypeScript's heap.
// esbuild starts a native child. Terminating a worker thread closes its libuv
// loop before it can reap that child, leaving a zombie under the daemon PID.
class PluginCompiler {
  private readonly queue = pLimit(COMPILER_POOL_SIZE);
  private readonly idleWorkers: CompilerProcess[] = [];
  private readonly activeWorkers = new Set<CompilerProcess>();

  run<T extends CompilerTask>(
    task: T,
    onLog?: (data: Record<string, unknown>, message: string) => void,
  ): Promise<TaskResult[T["kind"]]> {
    return this.queue(async () => {
      const worker = this.acquireWorker();
      worker.child.ref();
      worker.child.channel?.ref();
      try {
        return await this.request<T>(worker, task, onLog);
      } finally {
        this.releaseWorker(worker);
      }
    });
  }

  private acquireWorker(): CompilerProcess {
    while (this.idleWorkers.length > 0) {
      const candidate = this.idleWorkers.pop()!;
      if (candidate.idleTimer) {
        clearTimeout(candidate.idleTimer);
        candidate.idleTimer = null;
      }
      if (!candidate.retired && candidate.child.connected) {
        this.activeWorkers.add(candidate);
        return candidate;
      }
    }
    const created = this.startWorker();
    this.activeWorkers.add(created);
    return created;
  }

  private releaseWorker(worker: CompilerProcess): void {
    this.activeWorkers.delete(worker);
    if (worker.retired || !worker.child.connected) {
      this.stopWorker(worker);
      return;
    }
    worker.child.unref();
    worker.child.channel?.unref();
    worker.idleTimer = setTimeout(() => this.stopWorker(worker), IDLE_TIMEOUT_MS);
    worker.idleTimer.unref();
    this.idleWorkers.push(worker);
  }

  private startWorker(): CompilerProcess {
    const child = fork(workerUrl, [], {
      execArgv: workerExecArgv,
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: {
        ...process.env,
        NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE || DEFAULT_COMPILE_CACHE_DIR,
      },
    });
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.on("error", () => {
        if (child.pid === undefined) resolve();
      });
    });
    const worker: CompilerProcess = { child, exited, idleTimer: null, retired: false };
    child.once("disconnect", () => this.stopWorker(worker));
    void exited.then(() => this.stopWorker(worker));
    return worker;
  }

  private stopWorker(worker: CompilerProcess): void {
    if (worker.retired) return;
    worker.retired = true;
    this.activeWorkers.delete(worker);
    const idx = this.idleWorkers.indexOf(worker);
    if (idx !== -1) this.idleWorkers.splice(idx, 1);
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    // Close IPC so the compiler can finish any in-flight work and exit. Its
    // pipes close with it, ending esbuild's service.
    if (worker.child.connected) worker.child.disconnect();
  }

  private async request<T extends CompilerTask>(
    worker: CompilerProcess,
    task: T,
    onLog?: (data: Record<string, unknown>, message: string) => void,
  ): Promise<TaskResult[T["kind"]]> {
    let onMessage: (reply: CompilerReply) => void;
    let onError: (error: Error) => void;
    let onExit: (code: number) => void;
    let onDisconnect: () => void;
    const { child } = worker;
    try {
      return await new Promise<TaskResult[T["kind"]]>((resolve, reject) => {
        onError = reject;
        onExit = (code) => reject(new Error(`Plugin compiler worker exited (code ${code})`));
        onDisconnect = () => reject(new Error("Plugin compiler worker disconnected"));
        onMessage = (reply) => {
          if (reply.kind === "log") {
            onLog?.(reply.data, reply.message);
          } else if (reply.kind === "result") {
            resolve(reply.value as TaskResult[T["kind"]]);
          } else {
            const error = reply.issues ? new ZodError(reply.issues) : reply.error;
            Object.assign(error, reply.properties);
            if (reply.errors) Object.assign(error, { errors: reply.errors });
            if (reply.warnings) Object.assign(error, { warnings: reply.warnings });
            reject(error);
          }
        };
        child.on("error", onError);
        child.on("exit", onExit);
        child.on("disconnect", onDisconnect);
        child.on("message", onMessage);
        child.send(task, (error) => {
          if (!error) return;
          this.stopWorker(worker);
          reject(error);
        });
      });
    } finally {
      child.off("message", onMessage!);
      child.off("error", onError!);
      child.off("exit", onExit!);
      child.off("disconnect", onDisconnect!);
    }
  }
}

const compiler = new PluginCompiler();

export function runCompilerTask<T extends CompilerTask>(
  task: T,
  onLog?: (data: Record<string, unknown>, message: string) => void,
): Promise<TaskResult[T["kind"]]> {
  return compiler.run(task, onLog);
}

export function compilePlugin(entries: Parameters<typeof build.compilePlugin>[0]) {
  return runCompilerTask({ kind: "entries", entries });
}

async function computePluginDirectoryCacheKey(
  directory: string,
  version: string,
  builtinId?: string,
): Promise<string> {
  const canonical = await fsPromises.realpath(directory);
  const hash = createHash("sha256");
  hash.update(
    `${PLUGIN_COMPILE_CACHE_SCHEMA}\0${version ?? ""}\0${builtinId ?? ""}\0${canonical}\0`,
  );
  const visit = async (relative: string): Promise<void> => {
    const names = (await fsPromises.readdir(path.join(canonical, relative))).sort();
    for (const name of names) {
      if (name === ".git" || name === "node_modules") continue;
      const child = relative ? path.join(relative, name) : name;
      const target = path.join(canonical, child);
      const stats = await fsPromises.lstat(target, { bigint: true });
      const posix = child.split(path.sep).join("/");
      if (stats.isDirectory()) {
        hash.update(`D:${posix}\0`);
        await visit(child);
      } else if (stats.isSymbolicLink()) {
        hash.update(`L:${posix}:${await fsPromises.readlink(target)}\0`);
      } else {
        hash.update(`F:${posix}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}\0`);
      }
    }
  };
  await visit("");
  return hash.digest("hex");
}

async function computePluginDirectoryContentKey(
  directory: string,
  version: string,
  builtinId?: string,
): Promise<string> {
  const canonical = await fsPromises.realpath(directory);
  const hash = createHash("sha256");
  hash.update(`${PLUGIN_COMPILE_CACHE_SCHEMA}:content\0${version ?? ""}\0${builtinId ?? ""}\0`);
  const visit = async (relative: string): Promise<void> => {
    const names = (await fsPromises.readdir(path.join(canonical, relative))).sort();
    for (const name of names) {
      if (name === ".git" || name === "node_modules" || name === ".vibing-bundle.json") continue;
      const child = relative ? path.join(relative, name) : name;
      const target = path.join(canonical, child);
      const stats = await fsPromises.lstat(target);
      const posix = child.split(path.sep).join("/");
      if (stats.isDirectory()) {
        hash.update(`D:${posix}\0`);
        await visit(child);
      } else if (stats.isSymbolicLink()) {
        hash.update(`L:${posix}:${await fsPromises.readlink(target)}\0`);
      } else {
        hash.update(`F:${posix}\0`);
        hash.update(await fsPromises.readFile(target));
        hash.update("\0");
      }
    }
  };
  await visit("");
  return hash.digest("hex");
}

async function readCachedPluginBundles(filePath: string): Promise<TaskResult["directory"] | null> {
  try {
    const cached = JSON.parse(await fsPromises.readFile(filePath, "utf8")) as Partial<
      TaskResult["directory"]
    >;
    if (
      cached &&
      typeof cached === "object" &&
      cached.manifest &&
      "serverBundle" in cached &&
      "clientBundle" in cached
    ) {
      return cached as TaskResult["directory"];
    }
  } catch {}
  return null;
}

async function writeCachedPluginBundles(
  filePath: string,
  compiled: TaskResult["directory"],
): Promise<void> {
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    const tempFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fsPromises.writeFile(tempFile, JSON.stringify(compiled));
    await fsPromises.rename(tempFile, filePath);
  } catch {}
}

export async function compileDirectoryPlugin(
  directory: string,
  version: string,
  builtinId?: string,
  cacheHome?: string,
): Promise<TaskResult["directory"]> {
  let metaCacheFile: string | null = null;
  if (cacheHome) {
    try {
      const metaKey = await computePluginDirectoryCacheKey(directory, version, builtinId);
      metaCacheFile = path.join(cacheHome, ".plugin-compile-cache", `${metaKey}.json`);
      const metaHit = await readCachedPluginBundles(metaCacheFile);
      if (metaHit) return metaHit;
    } catch {}
  }
  let sharedCacheFile: string | null = null;
  if (cacheHome) {
    try {
      const contentKey = await computePluginDirectoryContentKey(directory, version, builtinId);
      sharedCacheFile = path.join(SHARED_PLUGIN_COMPILE_CACHE_DIR, `${contentKey}.json`);
      const sharedHit = await readCachedPluginBundles(sharedCacheFile);
      if (sharedHit) {
        if (metaCacheFile) await writeCachedPluginBundles(metaCacheFile, sharedHit);
        return sharedHit;
      }
    } catch {}
  }
  const compiled = await runCompilerTask({ kind: "directory", directory, version, builtinId });
  if (metaCacheFile) await writeCachedPluginBundles(metaCacheFile, compiled);
  if (sharedCacheFile) await writeCachedPluginBundles(sharedCacheFile, compiled);
  return compiled;
}
