import type { EntityManager } from "typeorm";
import { TaskEntity } from "../../database/entities/task.entity";

type IntegrationScope = {
  id: string;
  projectId: string;
  project?: { workspaceId: string };
};

export type ExpectedBinding = {
  config?: string;
  type?: string;
  validate?: (binding: { config: string; type: string }) => boolean;
};

export type AfterCommit = (effect: () => Promise<void>) => void;

/**
 * Runs `apply` in a transaction that holds the integration's project and,
 * when `taskId` is given, the task, so a concurrent move or disconnect waits
 * for the integration write. Answers undefined when the scope no longer
 * matches. Effects queued with `afterCommit` run after the commit.
 */
// Key-share protects the project/workspace key while allowing task-number
// allocation. Task locks protect their project until related writes commit.
export async function withIntegrationTask<T>(
  db: EntityManager,
  taskId: string | null,
  integration: IntegrationScope,
  apply: (tx: EntityManager, afterCommit: AfterCommit) => Promise<T>,
  expectedBinding?: ExpectedBinding,
): Promise<T | undefined> {
  const effects: Array<() => Promise<void>> = [];
  const result = await db.transaction(async (tx) => {
    if (taskId === null) {
      const binding = (await tx.query(
        `SELECT id FROM integration WHERE id = $1 AND is_active = true FOR NO KEY UPDATE`,
        [integration.id],
      )) as unknown[];
      if (!binding.length) return undefined;
    }
    const project = (await tx.query(
      `SELECT project.id FROM project
       INNER JOIN integration ON integration.project_id = project.id
       WHERE integration.id = $1 AND project.id = $2
         ${integration.project ? "AND project.workspace_id = $3" : ""}
       FOR KEY SHARE OF project, integration`,
      integration.project
        ? [integration.id, integration.projectId, integration.project.workspaceId]
        : [integration.id, integration.projectId],
    )) as unknown[];
    if (!project.length) return undefined;
    if (expectedBinding) {
      const conditions = ["id = $1", "is_active = true"];
      const values: unknown[] = [integration.id];
      if (expectedBinding.config !== undefined) {
        values.push(expectedBinding.config);
        conditions.push(`config = $${values.length}`);
      }
      if (expectedBinding.type !== undefined) {
        values.push(expectedBinding.type);
        conditions.push(`type = $${values.length}`);
      }
      const [binding] = (await tx.query(
        `SELECT config, type FROM integration WHERE ${conditions.join(" AND ")} FOR SHARE`,
        values,
      )) as { config: string; type: string }[];
      if (
        !binding ||
        (expectedBinding.validate && !expectedBinding.validate(binding))
      )
        return undefined;
    }
    if (taskId !== null) {
      const task = (await tx.query(
        `SELECT id FROM task WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE`,
        [taskId, integration.projectId],
      )) as unknown[];
      if (!task.length) return undefined;
    }
    return apply(tx, (effect) => effects.push(effect));
  });
  for (const effect of effects) await effect();
  return result;
}

/** The task, provided it still belongs to the integration's project. */
export function findLinkedTask(
  db: EntityManager,
  taskId: string,
  projectId: string,
): Promise<TaskEntity | null> {
  return db.findOne(TaskEntity, { where: { id: taskId, projectId } });
}

/**
 * SQL condition (for `external_link` aliased as `link`) that the link's task
 * still belongs to its integration's project.
 */
export const EXTERNAL_LINK_SCOPE = `exists (select 1 from task scoped_task join integration scoped_integration on scoped_integration.project_id = scoped_task.project_id where scoped_task.id = link.task_id and scoped_integration.id = link.integration_id)`;

/** The row version of the task, to detect concurrent edits. */
export async function integrationTaskRevision(
  db: EntityManager,
  taskId: string,
  projectId: string,
): Promise<string | undefined> {
  const [task] = (await db.query(
    `SELECT task.xmin::text AS revision FROM task WHERE id = $1 AND project_id = $2`,
    [taskId, projectId],
  )) as { revision: string }[];
  return task?.revision;
}
