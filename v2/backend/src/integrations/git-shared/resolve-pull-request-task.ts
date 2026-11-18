import type { EntityManager } from "typeorm";
import { TaskEntity } from "../../database/entities/task.entity";
import { findTaskByLink, findTaskByNumber } from "../links/integration-tasks";
import { extractTaskNumber } from "./branch-matcher";
import type { BranchMatchConfig } from "./branch-patterns";
import { extractIssueReferences } from "./issue-references";

export type PullRequestRef = {
  number: number;
  title: string;
  body: string | null;
  head: { ref: string };
};

/**
 * The task a pull request belongs to: by task number (branch, title, body),
 * else by the one linked issue it references, else by the one Kaneo task link
 * in its title or body. Undefined when nothing or more than one task matches.
 */
export async function resolvePullRequestTask(
  db: EntityManager,
  {
    integrationId,
    projectId,
    projectSlug,
    config,
    repositoryUrl,
    pullRequest,
  }: {
    integrationId: string;
    projectId: string;
    projectSlug: string;
    config: BranchMatchConfig;
    repositoryUrl: string;
    pullRequest: PullRequestRef;
  },
): Promise<TaskEntity | null | undefined> {
  const taskNumber = extractTaskNumber(
    pullRequest.head.ref,
    pullRequest.title,
    pullRequest.body ?? undefined,
    config,
    projectSlug,
  );
  const numberedTask =
    taskNumber === null
      ? undefined
      : await findTaskByNumber(db, projectId, taskNumber);
  if (numberedTask) return numberedTask;

  const issueNumbers = extractIssueReferences(
    pullRequest.title,
    pullRequest.body,
    repositoryUrl,
  );
  const matches =
    issueNumbers.length === 0
      ? []
      : await db
          .createQueryBuilder(TaskEntity, "task")
          .distinct(true)
          .innerJoin("external_link", "link", "link.task_id = task.id")
          .where("link.integration_id = :integrationId", { integrationId })
          .andWhere("link.resource_type = 'issue'")
          .andWhere("link.external_id IN (:...issueNumbers)", { issueNumbers })
          .andWhere("task.project_id = :projectId", { projectId })
          .limit(2)
          .getMany();
  if (matches.length > 0) {
    return matches.length === 1 ? matches[0] : undefined;
  }

  return findTaskByLink(db, projectId, [pullRequest.title, pullRequest.body]);
}
