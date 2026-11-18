import { beforeEach, expect, it, vi } from "vitest";
import { gitlabIssueAccess } from "./gitlab-issue-access";

// The previous provider-issue suite covered only Gitea; these pin the GitLab
// branch of the same function.
const client = vi.hoisted(() => ({ getIssue: vi.fn(), updateIssue: vi.fn() }));
vi.mock("./client/gitlab-client", () => ({
  createGitlabClient: () => client,
}));

const config = JSON.stringify({
  baseUrl: "https://gitlab.example",
  accessToken: "token",
  projectPath: "team/repo",
});

beforeEach(() => {
  vi.resetAllMocks();
});

it("reads an issue without the task footer and writes close/reopen as state events", async () => {
  client.getIssue.mockResolvedValue({
    title: "Remote title",
    description: "Remote body\n\n---\n<sub>Task: task</sub>",
    state: "opened",
    labels: ["bug"],
    updated_at: "2026-01-01T00:00:00Z",
  });
  client.updateIssue.mockResolvedValue({
    title: "Chosen title",
    description: "Chosen body\n\n---\n<sub>Task: task</sub>",
    state: "closed",
  });
  const access = gitlabIssueAccess(config, { externalId: "7", taskId: "task" });

  expect(await access.read()).toEqual({
    title: "Remote title",
    description: "Remote body",
    state: "open",
    updatedAt: "2026-01-01T00:00:00Z",
    contentVersion: null,
    labels: ["bug"],
  });
  expect(
    await access.write({
      title: "Chosen title",
      description: "Chosen body",
      state: "closed",
    }),
  ).toMatchObject({ description: "Chosen body", state: "closed" });
  expect(client.updateIssue).toHaveBeenCalledWith("team/repo", 7, {
    title: "Chosen title",
    description: "Chosen body\n\n---\n<sub>Task: task</sub>",
    state_event: "close",
  });
});

it("refuses a confidential issue", async () => {
  client.getIssue.mockResolvedValue({
    title: "Secret",
    description: "",
    state: "opened",
    confidential: true,
  });
  const access = gitlabIssueAccess(config, { externalId: "7", taskId: "task" });
  await expect(access.read()).rejects.toThrow(
    "Confidential issue cannot be synchronized",
  );
});

it("rejects an invalid issue number", () => {
  expect(() =>
    gitlabIssueAccess(config, { externalId: "x", taskId: "task" }),
  ).toThrow("Invalid issue number");
});
