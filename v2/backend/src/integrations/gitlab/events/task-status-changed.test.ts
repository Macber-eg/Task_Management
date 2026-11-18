import type { EntityManager } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskStatusChanged } from "./task-status-changed";

// Ported from tests/api/plugins/gitlab/events/task-status-changed.test.ts.
const mocks = vi.hoisted(() => ({
  issueLink: vi.fn(),
  updateExternalLink: vi.fn(),
  updateIssue: vi.fn(),
  updateLabels: vi.fn(),
}));

vi.mock("./find-issue-link", () => ({
  findIssueLink: async () => mocks.issueLink(),
}));

vi.mock("../../links/external-link-writes", () => ({
  updateExternalLink: (...args: unknown[]) => mocks.updateExternalLink(...args),
}));

vi.mock("../client/gitlab-client", () => ({
  createGitlabClient: () => ({
    updateIssue: (...args: unknown[]) => mocks.updateIssue(...args),
  }),
}));

vi.mock("../labels/issue-labels", () => ({
  updateIssueLabelsGitlab: (...args: unknown[]) => mocks.updateLabels(...args),
}));

// Policy enforcement is covered by the PostgreSQL sync-rules integration tests.
vi.mock("../../links/integration-tasks", () => ({
  isTaskInFinalState: async (_db: unknown, task: { status: string }) =>
    task.status === "done",
}));

vi.mock("../../sync/eligibility", () => ({
  canSyncTask: async () => true,
}));

vi.mock("../../sync/dispatch-issue-write", () => ({
  createIssueWrite: () => (send: () => Promise<unknown>) => send(),
}));

vi.mock("../../sync/sync-task-field-labels", () => ({
  syncTaskFieldLabels: async (
    _db: unknown,
    _remote: unknown,
    _taskId: string,
    _context: unknown,
    _link: unknown,
    _field: string,
    send: (changes: unknown, write: unknown) => Promise<void>,
  ) => {
    await send(
      { add: ["status:done"], remove: ["status:in-review"] },
      (run: () => Promise<unknown>) => run(),
    );
    return "done";
  },
}));

const db = {} as EntityManager;
const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    baseUrl: "https://gitlab.com",
    accessToken: "token",
    projectPath: "acme/web",
  },
};

function closeTask(sourceIntegrationId?: string) {
  return handleTaskStatusChanged(
    db,
    {
      sourceIntegrationId,
      taskId: "task-1",
      projectId: "project-1",
      userId: "user-1",
      oldStatus: "in-review",
      newStatus: "done",
      title: "Checkout button overlaps the footer",
    },
    context,
  );
}

function linkWithMetadata(metadata: string | null) {
  return {
    id: "link-1",
    integrationId: "integration-1",
    resourceType: "issue",
    externalId: "3",
    metadata,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleTaskStatusChanged link metadata", () => {
  it("still records the outbound close when stored metadata is malformed", async () => {
    mocks.issueLink.mockReturnValue(linkWithMetadata("{not json"));

    await closeTask();

    expect(mocks.updateIssue).toHaveBeenCalledOnce();
    expect(mocks.updateExternalLink).toHaveBeenCalledWith(db, "link-1", {
      metadata: expect.objectContaining({
        state: "closed",
        lastOutboundStateSyncAt: expect.any(Number),
      }),
    });
  });

  it("does not spread an array stored as metadata", async () => {
    mocks.issueLink.mockReturnValue(linkWithMetadata('["a","b"]'));

    await closeTask();

    expect(mocks.updateExternalLink).toHaveBeenCalledOnce();
    const [, , update] = mocks.updateExternalLink.mock.calls[0] as [
      unknown,
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(Object.keys(update.metadata).sort()).toEqual([
      "lastOutboundStateSyncAt",
      "state",
    ]);
  });

  it("keeps existing metadata fields", async () => {
    mocks.issueLink.mockReturnValue(
      linkWithMetadata(JSON.stringify({ author: "octocat", state: "opened" })),
    );

    await closeTask();

    expect(mocks.updateExternalLink).toHaveBeenCalledWith(db, "link-1", {
      metadata: expect.objectContaining({ author: "octocat", state: "closed" }),
    });
  });
});

describe("GitLab status webhook feedback", () => {
  it("does not echo a status change to its originating integration", async () => {
    await closeTask("integration-1");
    expect(mocks.issueLink).not.toHaveBeenCalled();
    expect(mocks.updateLabels).not.toHaveBeenCalled();
    expect(mocks.updateIssue).not.toHaveBeenCalled();
  });
  it("still syncs changes originating from another integration", async () => {
    mocks.issueLink.mockReturnValue(linkWithMetadata(null));
    await closeTask("another-integration");
    expect(mocks.updateLabels).toHaveBeenCalledOnce();
    expect(mocks.updateIssue).toHaveBeenCalledWith("acme/web", 3, {
      state_event: "close",
    });
  });
});
