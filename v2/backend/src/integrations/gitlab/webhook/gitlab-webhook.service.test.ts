import type { DataSource } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "../../../events/event-bus";
import { GitlabWebhookService } from "./gitlab-webhook.service";

// Ported from tests/api/plugins/gitlab/webhook-handler.test.ts.
const mocks = vi.hoisted(() => ({
  integrationFindOne: vi.fn(),
  handleGitlabMergeRequestOpened: vi.fn(),
  handleGitlabMergeRequestClosed: vi.fn(),
  handleGitlabIssueUpdated: vi.fn(),
  handleGitlabIssueClosed: vi.fn(),
}));

vi.mock("../webhooks/issue-updated", () => ({
  handleGitlabIssueUpdated: (...args: unknown[]) =>
    mocks.handleGitlabIssueUpdated(...args),
}));

vi.mock("../webhooks/issue-state", () => ({
  handleGitlabIssueClosed: (...args: unknown[]) =>
    mocks.handleGitlabIssueClosed(...args),
  handleGitlabIssueReopened: vi.fn(),
}));

vi.mock("../webhooks/merge-request-opened", () => ({
  handleGitlabMergeRequestOpened: (...args: unknown[]) =>
    mocks.handleGitlabMergeRequestOpened(...args),
}));

vi.mock("../webhooks/merge-request-closed", () => ({
  handleGitlabMergeRequestClosed: (...args: unknown[]) =>
    mocks.handleGitlabMergeRequestClosed(...args),
}));

const secret = "webhook-secret";
const manager = {
  findOne: (...args: unknown[]) => mocks.integrationFindOne(...args),
};
const service = new GitlabWebhookService(
  { manager } as unknown as DataSource,
  {} as EventBus,
);
const handle = (body: string, token: string) =>
  service.handle("integration-1", body, token);

function mergeRequestUpdate(changes: Record<string, unknown>) {
  return JSON.stringify({
    object_kind: "merge_request",
    object_attributes: {
      iid: 1,
      title: "Fix the Safari login button",
      description: null,
      url: "https://gitlab.com/acme/web/-/merge_requests/1",
      state: "opened",
      action: "update",
      source_branch: "kan-1",
    },
    changes,
    project: {
      name: "web",
      web_url: "https://gitlab.com/acme/web",
      path_with_namespace: "acme/web",
    },
  });
}

function mergeRequestOpen(draft: boolean) {
  return JSON.stringify({
    object_kind: "merge_request",
    object_attributes: {
      iid: 2,
      title: "Draft: Rework the checkout form",
      description: null,
      url: "https://gitlab.com/acme/web/-/merge_requests/2",
      state: "opened",
      action: "open",
      draft,
      source_branch: "kan-2",
    },
    project: {
      name: "web",
      web_url: "https://gitlab.com/acme/web",
      path_with_namespace: "acme/web",
    },
  });
}

function issueEvent({
  action,
  eventType = "issue",
  confidential = false,
}: {
  action: string;
  eventType?: string;
  confidential?: boolean;
}) {
  return JSON.stringify({
    object_kind: "issue",
    event_type: eventType,
    object_attributes: {
      iid: 7,
      title: "Payment provider keys",
      description: "internal details",
      url: "https://gitlab.com/acme/web/-/issues/7",
      action,
      confidential,
    },
    changes: { title: { previous: "Old", current: "Payment provider keys" } },
    project: {
      name: "web",
      web_url: "https://gitlab.com/acme/web",
      path_with_namespace: "acme/web",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.integrationFindOne.mockResolvedValue({
    id: "integration-1",
    type: "gitlab",
    config: JSON.stringify({ webhookSecret: secret }),
  });
});

describe("GitLab webhook merge request opened", () => {
  it("links a draft merge request without moving the task", async () => {
    await handle(mergeRequestOpen(true), secret);

    expect(mocks.handleGitlabMergeRequestOpened).toHaveBeenCalledWith(
      manager,
      expect.anything(),
      expect.anything(),
      "integration-1",
      { moveTask: false },
    );
  });

  it("moves the task when a merge request is opened ready for review", async () => {
    await handle(mergeRequestOpen(false), secret);

    expect(mocks.handleGitlabMergeRequestOpened).toHaveBeenCalledWith(
      manager,
      expect.anything(),
      expect.anything(),
      "integration-1",
      { moveTask: true },
    );
  });
});

describe("GitLab webhook merge request updates", () => {
  it("refreshes the link without moving the task when a merge request becomes a draft", async () => {
    const result = await handle(
      mergeRequestUpdate({ draft: { previous: false, current: true } }),
      secret,
    );

    expect(result.success).toBe(true);
    expect(mocks.handleGitlabMergeRequestOpened).toHaveBeenCalledWith(
      manager,
      expect.anything(),
      expect.anything(),
      "integration-1",
      { moveTask: false },
    );
  });

  it("moves the task when a merge request is taken out of draft", async () => {
    await handle(
      mergeRequestUpdate({ draft: { previous: true, current: false } }),
      secret,
    );

    expect(mocks.handleGitlabMergeRequestOpened).toHaveBeenCalledWith(
      manager,
      expect.anything(),
      expect.anything(),
      "integration-1",
      { moveTask: true },
    );
  });

  it("ignores an update that does not touch the draft flag", async () => {
    await handle(
      mergeRequestUpdate({ title: { previous: "a", current: "b" } }),
      secret,
    );

    expect(mocks.handleGitlabMergeRequestOpened).not.toHaveBeenCalled();
    expect(mocks.handleGitlabMergeRequestClosed).not.toHaveBeenCalled();
  });

  it("rejects a delivery whose token does not match", async () => {
    const result = await handle(
      mergeRequestUpdate({ draft: { previous: false, current: true } }),
      "wrong-secret",
    );

    expect(result).toEqual({ success: false, error: "Invalid webhook token" });
    expect(mocks.handleGitlabMergeRequestOpened).not.toHaveBeenCalled();
  });
});

describe("GitLab webhook handler failures", () => {
  it("reports a failing handler as a server error without its details", async () => {
    mocks.handleGitlabIssueClosed.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "task_pkey"'),
    );

    const result = await handle(issueEvent({ action: "close" }), secret);

    expect(result).toEqual({
      success: false,
      error: "Webhook handler failed",
      status: 500,
    });
  });
});

describe("GitLab webhook confidential issues", () => {
  it("passes a regular issue update to the handler", async () => {
    await handle(issueEvent({ action: "update" }), secret);

    expect(mocks.handleGitlabIssueUpdated).toHaveBeenCalledOnce();
  });

  it("drops an update to an issue that was made confidential", async () => {
    const result = await handle(
      issueEvent({
        action: "update",
        eventType: "confidential_issue",
        confidential: true,
      }),
      secret,
    );

    expect(result.success).toBe(true);
    expect(mocks.handleGitlabIssueUpdated).not.toHaveBeenCalled();
  });

  it("drops a confidential issue even without the event type", async () => {
    await handle(issueEvent({ action: "close", confidential: true }), secret);

    expect(mocks.handleGitlabIssueClosed).not.toHaveBeenCalled();
  });
});
