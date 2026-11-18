import type { EntityManager } from "typeorm";
import type { ProjectEntity } from "../../../database/entities/project.entity";
import type { GitHubImportState } from "../../../database/entities/types/github-import-state";
import { HTTPException } from "../../../common/errors/http-exception";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../links/extract-priority";
import { parseLinkMetadata } from "../../links/parse-link-metadata";
import { canSyncTask } from "../../sync/eligibility";
import { importIssueLabels } from "../../sync/issue-labels";
import type { GitHubConfig } from "../config/github-config";
import {
  commentsPageSchema,
  issuesPageSchema,
  labelsPageSchema,
  nextCursor,
  pullsPageSchema,
} from "./import-pages";
import { importConflict } from "./import-conflict";
import {
  findLink,
  importComments,
  importIssue,
  importLabels,
  linkPull,
  resolveImportedStatus,
} from "./import-rows";

export type ImportEvent =
  | "task.updated"
  | "task.labels_updated"
  | "comment.updated";

export type ImportPageContext = {
  integrationId: string;
  project: ProjectEntity;
  config: GitHubConfig;
  announce: (taskId: string, ...types: ImportEvent[]) => void;
  /** Whether the sync rules admit the page's issue (issues phase). */
  admitted: boolean;
  /** The issue's labels as read through REST, for the label rule import. */
  scopeLabels: unknown;
};

function finishIssue(state: GitHubImportState) {
  state.currentIssue = null;
  state.phase = state.moreIssues ? "issues" : "pulls";
}

function nextIssuePart(state: GitHubImportState) {
  const current = state.currentIssue;
  if (current && current.labelsRemaining > 0) state.phase = "labels";
  else if (current?.moreComments && current.commentsRemaining > 0)
    state.phase = "comments";
  else finishIssue(state);
}

function repositoryMatches(actual: number, state: GitHubImportState) {
  if (actual !== state.repositoryId) throw importConflict();
}

function pageError() {
  return new HTTPException(502, {
    message:
      "GitHub returned an invalid import page; saved progress can be resumed",
  });
}

function cursor(
  info: { hasNextPage: boolean; endCursor: string | null },
  previous: string | null,
) {
  try {
    return nextCursor(info, previous);
  } catch {
    throw pageError();
  }
}

function pageRemaining(page: {
  totalCount: number;
  nodes: unknown[];
  pageInfo: { hasNextPage: boolean };
}) {
  return page.pageInfo.hasNextPage
    ? Math.max(0, page.totalCount - page.nodes.length)
    : 0;
}

/**
 * Applies one fetched page to the import `state` (mutated in place) inside
 * the caller's transaction: an issue with its first labels and comments, a
 * continuation page of either, or a page of pull requests to link.
 */
export async function applyImportPage(
  tx: EntityManager,
  payload: unknown,
  state: GitHubImportState,
  context: ImportPageContext,
): Promise<void> {
  const { integrationId, project, config, announce } = context;
  if (state.phase === "issues") {
    const parsed = issuesPageSchema.safeParse(payload);
    if (!parsed.success) throw pageError();
    repositoryMatches(parsed.data.repository.databaseId, state);
    const page = parsed.data.repository.issues;
    state.issueCursor = cursor(page.pageInfo, state.issueCursor);
    state.moreIssues = page.pageInfo.hasNextPage;
    const issue = page.nodes[0];
    if (!issue || Date.parse(issue.createdAt) > Date.parse(state.startedAt)) {
      state.moreIssues = false;
      finishIssue(state);
      return;
    }
    if (
      !context.admitted &&
      !(await findLink(tx, integrationId, "issue", issue.number))
    ) {
      state.skipped++;
      finishIssue(state);
      return;
    }
    const task = await importIssue(tx, issue, integrationId, project.id);
    if (!task) {
      state.skipped++;
      finishIssue(state);
      return;
    }
    state[task.result]++;
    state.currentIssue = {
      number: issue.number,
      taskId: task.id,
      isNewTask: task.result === "imported",
      labelCursor: cursor(issue.labels.pageInfo, null),
      commentCursor: cursor(issue.comments.pageInfo, null),
      labelsRemaining: pageRemaining(issue.labels),
      commentsRemaining: pageRemaining(issue.comments),
      moreComments: issue.comments.pageInfo.hasNextPage,
      statusSeen: issue.labels.nodes.some((label) =>
        label.name.startsWith("status:"),
      ),
      prioritySeen: issue.labels.nodes.some((label) =>
        label.name.startsWith("priority:"),
      ),
    };
    await importIssueLabels(
      tx,
      task.id,
      project.workspaceId,
      context.scopeLabels,
    );
    await importLabels(tx, issue.labels.nodes, task.id, project.workspaceId);
    await canSyncTask(tx, task.id, integrationId);
    await importComments(tx, issue.comments.nodes, task.id, state.startedAt);
    announce(task.id, "task.updated", "task.labels_updated", "comment.updated");
    nextIssuePart(state);
    return;
  }
  if (state.phase === "pulls") {
    const parsed = pullsPageSchema.safeParse(payload);
    if (!parsed.success) throw pageError();
    repositoryMatches(parsed.data.repository.databaseId, state);
    const page = parsed.data.repository.pullRequests;
    state.pullCursor = cursor(page.pageInfo, state.pullCursor);
    for (const pull of page.nodes) {
      if (Date.parse(pull.createdAt) > Date.parse(state.startedAt)) {
        state.phase = "complete";
        return;
      }
      const taskId = await linkPull(tx, pull, integrationId, project, config);
      if (taskId) announce(taskId, "task.updated");
    }
    if (!page.pageInfo.hasNextPage || page.nodes.length === 0)
      state.phase = "complete";
    return;
  }
  await applyContinuationPage(tx, payload, state, context);
}

async function applyContinuationPage(
  tx: EntityManager,
  payload: unknown,
  state: GitHubImportState,
  { integrationId, project, announce }: ImportPageContext,
) {
  const current = state.currentIssue;
  if (!current) throw new Error("Import continuation missing");
  const [task] = (await tx.query(
    `SELECT id, status FROM task WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE`,
    [current.taskId, project.id],
  )) as { id: string; status: string }[];
  const [linked] = (await tx.query(
    `SELECT id, metadata, created_at AS "createdAt" FROM external_link
     WHERE integration_id = $1 AND resource_type = 'issue' AND external_id = $2 AND task_id = $3
     FOR UPDATE`,
    [integrationId, String(current.number), current.taskId],
  )) as { id: string; metadata: string | null; createdAt: Date }[];
  if (linked && current.isNewTask === undefined) {
    const metadata = parseLinkMetadata<{ createdFrom?: string }>(
      linked.metadata,
      { externalLinkId: linked.id, source: "github_import_continuation" },
    );
    current.isNewTask =
      metadata.createdFrom === "github-import" &&
      linked.createdAt.getTime() >= Date.parse(state.startedAt);
  }
  const eligible =
    task && linked && (await canSyncTask(tx, current.taskId, integrationId));
  // A newly admitted issue's initial history belongs to the explicit import,
  // even when its resulting link is paused for outgoing sync.
  if (!task || !linked || (!eligible && !current.isNewTask)) {
    state.skipped++;
    finishIssue(state);
    return;
  }
  if (state.phase === "labels") {
    const parsed = labelsPageSchema.safeParse(payload);
    if (!parsed.success) throw pageError();
    repositoryMatches(parsed.data.repository.databaseId, state);
    const page = parsed.data.repository.issue?.labels;
    if (!page) {
      state.skipped++;
      finishIssue(state);
      return;
    }
    const labels = page.nodes.slice(0, current.labelsRemaining);
    current.labelCursor = cursor(page.pageInfo, current.labelCursor);
    current.labelsRemaining =
      page.pageInfo.hasNextPage && labels.length
        ? Math.max(0, current.labelsRemaining - labels.length)
        : 0;
    const priority = current.prioritySeen ? null : extractIssuePriority(labels);
    const status = current.statusSeen ? null : extractIssueStatus(labels);
    if (priority || status) {
      const placement = status
        ? await resolveImportedStatus(tx, project.id, status, task.status)
        : undefined;
      await tx.query(
        `UPDATE task SET
           priority = COALESCE($1, priority),
           status = COALESCE($2, status),
           column_id = CASE WHEN $3::boolean THEN $4 ELSE column_id END,
           updated_at = $5
         WHERE id = $6 AND project_id = $7`,
        [
          priority,
          placement?.status ?? null,
          placement !== undefined,
          placement?.columnId ?? null,
          new Date(),
          task.id,
          project.id,
        ],
      );
    }
    current.prioritySeen ||= labels.some((label) =>
      label.name.startsWith("priority:"),
    );
    current.statusSeen ||= labels.some((label) =>
      label.name.startsWith("status:"),
    );
    await importLabels(tx, labels, task.id, project.workspaceId);
    announce(task.id, "task.updated", "task.labels_updated");
    nextIssuePart(state);
  } else if (state.phase === "comments") {
    const parsed = commentsPageSchema.safeParse(payload);
    if (!parsed.success) throw pageError();
    repositoryMatches(parsed.data.repository.databaseId, state);
    const page = parsed.data.repository.issue?.comments;
    if (!page) {
      state.skipped++;
      finishIssue(state);
      return;
    }
    const comments = page.nodes.slice(0, current.commentsRemaining);
    current.commentCursor = cursor(page.pageInfo, current.commentCursor);
    current.commentsRemaining = Math.max(
      0,
      current.commentsRemaining - comments.length,
    );
    current.moreComments = page.pageInfo.hasNextPage && comments.length > 0;
    await importComments(tx, comments, task.id, state.startedAt);
    announce(task.id, "comment.updated");
    nextIssuePart(state);
  }
}
