import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityManager } from "typeorm";
import { removeLabelFromGitlab, syncLabelToGitlab } from "./sync-label-to-gitlab";

const mocks = vi.hoisted(() => ({
  externalLinkFind: vi.fn(),
  createGitlabClient: vi.fn(),
  client: {
    listLabels: vi.fn(),
    createLabel: vi.fn(),
    getIssue: vi.fn(),
    updateIssue: vi.fn(),
  },
}));

vi.mock("../client/gitlab-client", () => ({
  createGitlabClient: (...args: unknown[]) => mocks.createGitlabClient(...args),
}));

// Policy enforcement is covered by the PostgreSQL sync-rules integration tests.
vi.mock("../../sync/eligibility", () => ({
  canSyncTask: async () => true,
}));

vi.mock("../../sync/dispatch-issue-write", () => ({
  dispatchIssueWrite: async (
    _db: unknown,
    _link: unknown,
    _config: unknown,
    send: () => Promise<unknown>,
  ) => ({ value: await send() }),
}));

const db = {
  find: (...args: unknown[]) => mocks.externalLinkFind(...args),
} as unknown as EntityManager;

function issueLink(isActive: boolean | null) {
  return {
    id: "link-1",
    taskId: "task-1",
    resourceType: "issue",
    externalId: "3",
    integration: {
      id: "integration-1",
      type: "gitlab",
      isActive,
      config: JSON.stringify({
        baseUrl: "https://gitlab.com",
        accessToken: "token",
        projectPath: "acme/web",
      }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createGitlabClient.mockReturnValue(mocks.client);
  mocks.client.listLabels.mockResolvedValue([{ id: 1, name: "bug" }]);
  mocks.client.getIssue.mockResolvedValue({ iid: 3, labels: [] });
  mocks.client.updateIssue.mockResolvedValue({ iid: 3 });
});

describe("GitLab label sync", () => {
  it("adds a label to the issue of an active integration", async () => {
    mocks.externalLinkFind.mockResolvedValue([issueLink(true)]);

    await syncLabelToGitlab(db, "task-1", "bug", "#EF4444");

    expect(mocks.client.updateIssue).toHaveBeenCalledWith("acme/web", 3, {
      add_labels: "bug",
    });
  });

  it("leaves GitLab alone when the integration is disabled", async () => {
    mocks.externalLinkFind.mockResolvedValue([issueLink(false)]);

    await syncLabelToGitlab(db, "task-1", "bug", "#EF4444");
    await removeLabelFromGitlab(db, "task-1", "bug");

    expect(mocks.createGitlabClient).not.toHaveBeenCalled();
    expect(mocks.client.updateIssue).not.toHaveBeenCalled();
  });
});

it.each([
  "priority:urgent",
  "status:done",
  "bug,priority:urgent",
  "bug, status:done",
])(
  "does not add or remove task-field label %s with ordinary label permissions",
  async (name) => {
    mocks.externalLinkFind.mockResolvedValue([issueLink(true)]);
    await syncLabelToGitlab(db, "task-1", name, "red");
    await removeLabelFromGitlab(db, "task-1", name);
    expect(mocks.createGitlabClient).not.toHaveBeenCalled();
    expect(mocks.client.updateIssue).not.toHaveBeenCalled();
  },
);

it("still removes ordinary labels", async () => {
  mocks.externalLinkFind.mockResolvedValue([issueLink(true)]);
  await removeLabelFromGitlab(db, "task-1", "bug");
  expect(mocks.client.updateIssue).toHaveBeenCalledWith("acme/web", 3, {
    remove_labels: "bug",
  });
});
