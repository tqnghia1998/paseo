import { parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { runGitCommand } from "../../utils/run-git-command.js";

/** Local Git evidence only: never fetch, switch branches or change the worktree. */
export async function verifyChiefReviewWorkspace(
  cwd: string,
  review: { sourceBranch: string; sourceRepository: string },
): Promise<void> {
  const options = { cwd, timeout: 10_000, maxOutputBytes: 4096 };
  const [branch, remote] = await Promise.all([
    runGitCommand(["symbolic-ref", "--quiet", "--short", "HEAD"], options),
    runGitCommand(["remote", "get-url", "origin"], options),
  ]);
  if (branch.truncated || branch.stdout.trim() !== review.sourceBranch)
    throw new Error("The actual checkout branch does not match the expected workspace branch.");
  const actual = parseGitRemoteLocation(remote.stdout.trim());
  const expected = parseGitRemoteLocation(review.sourceRepository);
  if (
    remote.truncated ||
    !actual ||
    !expected ||
    actual.host !== expected.host ||
    actual.path !== expected.path ||
    actual.port !== expected.port
  )
    throw new Error(
      "The actual checkout origin repository does not match the expected workspace repository.",
    );
}
