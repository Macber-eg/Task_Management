import { vi } from "vitest";
import { ExternalLinkEntity } from "../../../src/database/entities/external-link.entity";
import { IntegrationEntity } from "../../../src/database/entities/integration.entity";
import { LabelEntity } from "../../../src/database/entities/label.entity";
import type {
  IssueValues,
  ProviderIssueSnapshot,
} from "../../../src/integrations/core/issue-access";
import type { SyncRules } from "../../../src/integrations/sync/rules";
import { getSyncIntegration } from "../../../src/integrations/sync-routes/get-sync-integration";
import { previewSyncRules } from "../../../src/integrations/sync-routes/preview-sync-rules";
import type { TestApp } from "../test-app";
import { createProjectFixture } from "./create-project-fixture";
import { createTask } from "./create-task";
import { createWorkspaceMember } from "./create-workspace-member";
import { insertRow } from "./insert-row";

type Snapshot = Partial<ProviderIssueSnapshot> & IssueValues;

/**
 * Stands in for a provider's issue (`ProviderIssues.open`), as the previous
 * suite's mocked `providerIssue`: `write` updates what `read` answers next.
 */
export function createProviderIssueDouble() {
  const provider = {
    read: vi.fn<() => Promise<Snapshot>>(),
    write: vi.fn<(values: IssueValues) => Promise<Partial<Snapshot>>>(),
  };
  const reset = () => {
    provider.read.mockReset().mockResolvedValue({
      title: "Repository title",
      description: "Repository body",
      state: "closed",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    provider.write.mockReset().mockImplementation(async (values) => {
      const current = await provider.read.mock.results.at(-1)!.value;
      provider.read.mockResolvedValue({
        ...current,
        ...values,
        updatedAt: "2026-01-02T00:00:00Z",
      });
      return { updatedAt: "2026-01-02T00:00:00Z" };
    });
  };
  reset();
  return {
    provider,
    reset,
    issues: { open: async () => provider },
  };
}

/** A Gitea integration with a workspace label "sync", one task and helpers. */
export async function setupSyncFixture(app: TestApp, role = "owner") {
  const db = app.db;
  const member = await createWorkspaceMember(db, { role });
  const { project, columns } = await createProjectFixture(db, {
    workspaceId: member.workspace.id,
  });
  const integration = await insertRow(db, IntegrationEntity, {
    projectId: project.id,
    type: "gitea",
    isActive: true,
    config: JSON.stringify({
      baseUrl: "https://git.example",
      accessToken: "test-only",
      repositoryOwner: "team",
      repositoryName: "repo",
    }),
  });
  const label = await insertRow(db, LabelEntity, {
    workspaceId: member.workspace.id,
    name: "sync",
    color: "#123456",
  });
  const task = await createTask(db, {
    projectId: project.id,
    title: "Kaneo title",
    description: "Kaneo body",
    status: columns.todo.slug,
    columnId: columns.todo.id,
    number: 1,
  });
  app.auth.signIn(member.user);
  const path = `/api/integration-sync/project/${project.id}/gitea`;
  const rules: SyncRules = {
    outgoing: { mode: "labels", match: "any", labels: [label.id] },
    incoming: { mode: "labels", match: "any", labels: ["sync"] },
  };
  const assign = () =>
    insertRow(db, LabelEntity, {
      taskId: task.id,
      workspaceId: member.workspace.id,
      name: label.name,
      color: label.color,
    });
  const link = (paused = false) =>
    insertRow(db, ExternalLinkEntity, {
      taskId: task.id,
      integrationId: integration.id,
      resourceType: "issue",
      externalId: "9",
      url: "https://git.example/team/repo/issues/9",
      metadata: JSON.stringify({
        syncFilterPaused: paused,
        retained: "preserve-me",
      }),
    });
  const request = (
    suffix: string,
    method: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    app.request(path + suffix, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const setRules = (selected: SyncRules = rules) =>
    db.query(`UPDATE integration SET config = $1 WHERE id = $2`, [
      JSON.stringify({ ...JSON.parse(integration.config), syncRules: selected }),
      integration.id,
    ]);
  const preview = async (selected = rules) =>
    previewSyncRules(
      db,
      await getSyncIntegration(db, project.id, "gitea"),
      selected,
    );
  return {
    ...member,
    project,
    columns,
    integration,
    label,
    task,
    rules,
    assign,
    link,
    request,
    setRules,
    preview,
  };
}

export type SyncFixture = Awaited<ReturnType<typeof setupSyncFixture>>;
