import { beforeEach, expect, it, vi } from "vitest";
import { giteaIssueAccess } from "./gitea-issue-access";

// Ported from apps/api/src/plugins/sync/provider-issue.test.ts (Gitea branch).
const client = vi.hoisted(() => ({ getIssue: vi.fn(), updateIssue: vi.fn() }));
vi.mock("./client/gitea-client", () => ({
  createGiteaClient: () => client,
}));

const config = JSON.stringify({
  repositoryOwner: "team",
  repositoryName: "repo",
});

beforeEach(() => {
  vi.resetAllMocks();
  client.updateIssue.mockResolvedValue({
    title: "Chosen title",
    body: "Chosen body",
    state: "open",
  });
});

it.each([0, 42, undefined])(
  "uses the observed Gitea content version %s when resuming",
  async (version) => {
    client.getIssue.mockResolvedValue({
      title: "Remote title",
      body: "Remote body",
      state: "open",
      content_version: version,
    });
    const access = giteaIssueAccess(config, { externalId: "7", taskId: "task" });
    expect((await access.read()).contentVersion).toBe(version ?? null);
    await access.write({
      title: "Chosen title",
      description: "Chosen body",
      state: "open",
    });
    const payload = client.updateIssue.mock.calls[0]![3];
    if (version === undefined)
      expect(payload).not.toHaveProperty("content_version");
    else expect(payload.content_version).toBe(version);
  },
);

it("propagates a Gitea version conflict without retrying an unconditional write", async () => {
  client.getIssue.mockResolvedValue({
    title: "Remote title",
    body: "Remote body",
    state: "open",
    content_version: 2,
  });
  client.updateIssue.mockRejectedValue(new Error("Test version conflict"));
  const access = giteaIssueAccess(config, { externalId: "7", taskId: "task" });
  await access.read();
  await expect(
    access.write({
      title: "Chosen title",
      description: "Chosen body",
      state: "open",
    }),
  ).rejects.toThrow("Test version conflict");
  expect(client.updateIssue).toHaveBeenCalledOnce();
  expect(client.updateIssue.mock.calls[0]![3].content_version).toBe(2);
});
