import { createId } from "@paralleldrive/cuid2";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import type { ProjectEntity } from "../../../database/entities/project.entity";
import { claimTaskNumber } from "../../../task/shared/claim-task-numbers";
import { VIRTUAL_STATUSES } from "../../../task/shared/task-status";
import { resolvePullRequestTask } from "../../git-shared/resolve-pull-request-task";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { formatTaskDescriptionFromIssue } from "../../links/issue-format";
import { canSyncTask } from "../../sync/eligibility";
import type { GitHubConfig } from "../config/github-config";
import type {
  ImportedComment,
  ImportedIssue,
  ImportedLabel,
  ImportedPull,
} from "./import-pages";

/** The status (and column) an imported issue lands in: requested, else current, else to-do, else the first column. */
export async function resolveImportedStatus(
  tx: EntityManager,
  projectId: string,
  requested: string | null,
  current?: string,
): Promise<{ status: string; columnId: string | null }> {
  for (const status of [requested, current, "to-do"]) {
    if (!status) continue;
    const [column] = (await tx.query(
      `SELECT id FROM "column" WHERE project_id = $1 AND slug = $2 LIMIT 1`,
      [projectId, status],
    )) as { id: string }[];
    if (column) return { status, columnId: column.id };
    if ((VIRTUAL_STATUSES as readonly string[]).includes(status))
      return { status, columnId: null };
  }
  const [first] = (await tx.query(
    `SELECT id, slug FROM "column" WHERE project_id = $1 ORDER BY position ASC LIMIT 1`,
    [projectId],
  )) as { id: string; slug: string }[];
  return { status: first?.slug ?? "planned", columnId: first?.id ?? null };
}

export function findLink(
  tx: EntityManager,
  integrationId: string,
  resourceType: string,
  externalId: number,
): Promise<ExternalLinkEntity | null> {
  return tx.findOne(ExternalLinkEntity, {
    where: { integrationId, resourceType, externalId: String(externalId) },
  });
}

/** Updates the linked task, or creates a task and its issue link. Null when the link's task may not be synced. */
export async function importIssue(
  tx: EntityManager,
  issue: ImportedIssue,
  integrationId: string,
  projectId: string,
): Promise<{ id: string; result: "imported" | "updated" } | null> {
  const link = await findLink(tx, integrationId, "issue", issue.number);
  const priority = extractIssuePriority(issue.labels.nodes);
  const status = extractIssueStatus(issue.labels.nodes);
  if (link) {
    if (!(await canSyncTask(tx, link.taskId, integrationId))) return null;
    const [task] = (await tx.query(
      `SELECT id, status FROM task WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE`,
      [link.taskId, projectId],
    )) as { id: string; status: string }[];
    if (!task) return null;
    const [linked] = (await tx.query(
      `SELECT id FROM external_link WHERE id = $1 FOR UPDATE`,
      [link.id],
    )) as unknown[];
    if (!linked) return null;
    const placement = await resolveImportedStatus(
      tx,
      projectId,
      status,
      task.status,
    );
    const values: unknown[] = [
      issue.title,
      formatTaskDescriptionFromIssue(issue.body, task.id),
      placement.status,
      placement.columnId,
      new Date(),
      task.id,
      projectId,
    ];
    if (priority) values.push(priority);
    const [rows] = (await tx.query(
      `UPDATE task SET title = $1, description = $2, status = $3, column_id = $4, updated_at = $5
         ${priority ? ", priority = $8" : ""}
       WHERE id = $6 AND project_id = $7 RETURNING id`,
      values,
    )) as [{ id: string }[], number];
    const updated = rows[0];
    return updated ? { id: updated.id, result: "updated" } : null;
  }
  const number = await claimTaskNumber(tx, projectId);
  const placement = await resolveImportedStatus(tx, projectId, status);
  const [created] = (await tx.query(
    `INSERT INTO task (id, project_id, assignee_id, title, description, status, column_id, priority, number)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      createId(),
      projectId,
      issue.title,
      formatTaskDescriptionFromIssue(issue.body),
      placement.status,
      placement.columnId,
      priority ?? "low",
      number,
    ],
  )) as { id: string }[];
  if (!created) throw new Error("Failed to create imported task");
  await tx.query(
    `INSERT INTO external_link (id, task_id, integration_id, resource_type, external_id, url, title, metadata)
     VALUES ($1, $2, $3, 'issue', $4, $5, $6, $7)`,
    [
      createId(),
      created.id,
      integrationId,
      String(issue.number),
      issue.url,
      issue.title,
      JSON.stringify({
        state: issue.state.toLowerCase(),
        createdFrom: "github-import",
        author: issue.author?.login,
      }),
    ],
  );
  return { id: created.id, result: "imported" };
}

/** Copies issue labels (other than priority/status) onto the task, preferring the workspace label's colour. */
export async function importLabels(
  tx: EntityManager,
  labels: ImportedLabel[],
  taskId: string,
  workspaceId: string,
): Promise<void> {
  for (const label of labels) {
    if (label.name.startsWith("priority:") || label.name.startsWith("status:"))
      continue;
    const [root] = (await tx.query(
      `SELECT color FROM label WHERE workspace_id = $1 AND name = $2 AND task_id IS NULL LIMIT 1`,
      [workspaceId, label.name],
    )) as { color: string }[];
    await tx.query(
      `INSERT INTO label (id, name, color, task_id, workspace_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (task_id, name) DO NOTHING`,
      [
        createId(),
        label.name,
        root?.color || `#${label.color}`,
        taskId,
        workspaceId,
      ],
    );
  }
}

/** Human comments created before the import started, as external comment activities. */
export async function importComments(
  tx: EntityManager,
  comments: ImportedComment[],
  taskId: string,
  startedAt: string,
): Promise<void> {
  const rows = comments.filter(
    (comment) =>
      comment.author?.__typename !== "Bot" &&
      !comment.author?.login.endsWith("[bot]") &&
      Date.parse(comment.createdAt) <= Date.parse(startedAt),
  );
  if (!rows.length) return;
  const values: unknown[] = [];
  const tuples = rows.map((comment) => {
    values.push(
      createId(),
      taskId,
      comment.body,
      comment.author?.login ?? "Unknown",
      comment.author?.avatarUrl ?? null,
      comment.url,
    );
    const base = values.length - 6;
    return `($${base + 1}, $${base + 2}, 'comment', $${base + 3}, $${base + 4}, $${base + 5}, 'github', $${base + 6})`;
  });
  await tx.query(
    `INSERT INTO activity (id, task_id, type, content, external_user_name, external_user_avatar, external_source, external_url)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (task_id, external_source, external_url) DO NOTHING`,
    values,
  );
}

/** Links an open pull request to the task it resolves to; answers that task's id. */
export async function linkPull(
  tx: EntityManager,
  pull: ImportedPull,
  integrationId: string,
  project: ProjectEntity,
  config: GitHubConfig,
): Promise<string | undefined> {
  if (await findLink(tx, integrationId, "pull_request", pull.number)) return;
  const task = await resolvePullRequestTask(tx, {
    integrationId,
    projectId: project.id,
    projectSlug: project.slug,
    config,
    repositoryUrl: `https://github.com/${config.repositoryOwner}/${config.repositoryName}`,
    pullRequest: {
      number: pull.number,
      title: pull.title,
      body: pull.body,
      head: { ref: pull.headRefName },
    },
  });
  if (!task) return;
  const [scopedTask] = (await tx.query(
    `SELECT id FROM task WHERE id = $1 AND project_id = $2 FOR SHARE`,
    [task.id, project.id],
  )) as unknown[];
  if (!scopedTask) return;
  await tx.query(
    `INSERT INTO external_link (id, task_id, integration_id, resource_type, external_id, url, title, metadata)
     VALUES ($1, $2, $3, 'pull_request', $4, $5, $6, $7)`,
    [
      createId(),
      task.id,
      integrationId,
      String(pull.number),
      pull.url,
      pull.title,
      JSON.stringify({
        state: pull.state.toLowerCase(),
        branch: pull.headRefName,
        author: pull.author?.login,
      }),
    ],
  );
  return task.id;
}
