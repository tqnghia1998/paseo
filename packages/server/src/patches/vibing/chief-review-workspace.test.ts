import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { verifyChiefReviewWorkspace } from "./chief-review-workspace.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function repository() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "chief-review-checkout-"));
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init", "--initial-branch=feature/login");
  await writeFile(path.join(cwd, "file.txt"), "fixture");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  );
  git("remote", "add", "origin", "git@git.example.test:team/repo.git");
  return { cwd, git };
}
const review = {
  sourceBranch: "feature/login",
  sourceRepository: "https://git.example.test/team/repo",
};

test("verifies the actual branch and normalizes SSH/HTTPS repository identity without fetching", async () => {
  const { cwd } = await repository();
  await expect(verifyChiefReviewWorkspace(cwd, review)).resolves.toBeUndefined();
});

test("refuses a different branch, different repository and detached checkout", async () => {
  const { cwd, git } = await repository();
  git("switch", "-c", "unrelated");
  await expect(verifyChiefReviewWorkspace(cwd, review)).rejects.toThrow(/branch|checkout/i);
  git("switch", "feature/login");
  git("remote", "set-url", "origin", "https://git.example.test/another/repo");
  await expect(verifyChiefReviewWorkspace(cwd, review)).rejects.toThrow(/repository|origin/i);
  git("remote", "set-url", "origin", review.sourceRepository);
  git("checkout", "--detach");
  await expect(verifyChiefReviewWorkspace(cwd, review)).rejects.toThrow();
});
