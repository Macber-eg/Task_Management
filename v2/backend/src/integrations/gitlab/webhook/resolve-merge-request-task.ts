import type { EntityManager } from "typeorm";
import type { TaskEntity } from "../../../database/entities/task.entity";
import { extractTaskNumber } from "../../git-shared/branch-matcher";
import { findTaskByLink, findTaskByNumber } from "../../links/integration-tasks";
import type { GitlabConfig } from "../config";

/** The task a merge request names by branch, title or description, or links to. */
export async function resolveMergeRequestTask(
  db: EntityManager,
  {
    projectId,
    projectSlug,
    config,
    mergeRequest,
  }: {
    projectId: string;
    projectSlug: string;
    config: GitlabConfig;
    mergeRequest: {
      title: string;
      description: string | null;
      source_branch: string;
    };
  },
): Promise<TaskEntity | null | undefined> {
  const taskNumber = extractTaskNumber(
    mergeRequest.source_branch,
    mergeRequest.title,
    mergeRequest.description ?? undefined,
    config,
    projectSlug,
  );
  const numberedTask = taskNumber
    ? await findTaskByNumber(db, projectId, taskNumber)
    : undefined;

  return (
    numberedTask ??
    findTaskByLink(db, projectId, [mergeRequest.title, mergeRequest.description])
  );
}
