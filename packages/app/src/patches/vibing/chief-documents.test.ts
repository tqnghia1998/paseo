import { expect, it, vi } from "vitest";
import { createChiefDocumentBridge } from "./chief-documents";
import type { ChiefState } from "./chief-handshake";
const state: ChiefState = {
  phase: "ready",
  requestId: "bound",
  active: true,
  session: {
    protocol: 1,
    status: "ready",
    policy: "chief-v1",
    serverId: "local",
    agentId: "chief",
    workspaceId: "chief-root",
    cwd: "/managed",
    provider: "claude",
  },
};
it("opens the exact resolved document under the bound Chief root", () => {
  const open = vi.fn(() => true);
  const post = vi.fn();
  createChiefDocumentBridge({ state: () => state, open, post })({
    type: "space:chief-open-document",
    requestId: "bound",
    id: "doc",
    root: "/managed",
    path: "app-worktrees/A/report.pdf",
  });
  expect(open).toHaveBeenCalledWith("local", "chief-root", "app-worktrees/A/report.pdf");
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ id: "doc", outcome: "opened" }));
});
it("rejects stale requests, wrong roots, traversal and a missing viewer", () => {
  const open = vi.fn(() => false);
  const post = vi.fn();
  const receive = createChiefDocumentBridge({ state: () => state, open, post });
  const request = {
    type: "space:chief-open-document",
    requestId: "bound",
    id: "doc",
    root: "/managed",
    path: "report.pdf",
  };
  receive({ ...request, requestId: "stale" });
  expect(post).not.toHaveBeenCalled();
  for (const path of ["../report.pdf", "/tmp/a", "a\\b", "a\nb"]) receive({ ...request, path });
  receive({ ...request, root: "/other" });
  expect(open).not.toHaveBeenCalled();
  receive(request);
  expect(open).toHaveBeenCalledOnce();
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "unavailable" }));
});
