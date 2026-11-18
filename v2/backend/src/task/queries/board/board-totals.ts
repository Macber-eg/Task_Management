import type { EntityManager } from "typeorm";
import { taskIsCompletedSql } from "../task-is-completed";
import type { TaskFilter } from "./board-options";
import { boardRevisionSql } from "./board-revision";
import { sortValueSql, type TaskSortBy } from "./task-sort";

type Total = { count: string; revision: string };

/** How many tasks match the filter, and their public revision. */
export async function countBoardTasks(
  tx: EntityManager,
  filter: TaskFilter,
  publicOnly: boolean | undefined,
  sortBy: TaskSortBy | undefined,
): Promise<Total | undefined> {
  const revision = boardRevisionSql(publicOnly, [
    "t.id",
    sortValueSql(sortBy),
    "t.status",
    // Row versions detect content edits without hashing large descriptions.
    "t.xmin::text",
    "u.name",
    "u.image",
  ]);
  const [total] = (await tx.query(
    `SELECT count(*) AS count, ${revision} AS revision FROM task t
     ${publicOnly ? `LEFT JOIN "user" u ON t.assignee_id = u.id` : ""}
     WHERE ${filter.sql}`,
    filter.parameters,
  )) as Total[];
  return total;
}

export async function countBoardColumns(
  tx: EntityManager,
  projectId: string,
  publicOnly: boolean | undefined,
): Promise<Total | undefined> {
  const revision = boardRevisionSql(publicOnly, [
    "c.id",
    "c.slug",
    "c.position",
    "c.name",
    "c.icon",
    "c.is_final",
  ]);
  const [total] = (await tx.query(
    `SELECT count(*) AS count, ${revision} AS revision
     FROM "column" c WHERE c.project_id = $1`,
    [projectId],
  )) as Total[];
  return total;
}

/** Totals and revisions of the labels and links on one task page. */
export async function countTaskPageRelated(
  tx: EntityManager,
  taskIds: string[],
  publicOnly: boolean | undefined,
) {
  if (!taskIds.length)
    return {
      labelCount: 0,
      linkCount: 0,
      labelRevision: "0",
      linkRevision: "0",
    };
  const [labels] = (await tx.query(
    `SELECT count(*) AS count, ${boardRevisionSql(publicOnly, [
      "l.id",
      "l.task_id",
      "l.name",
      "l.color",
    ])} AS revision
     FROM label l WHERE l.task_id = ANY($1::text[])`,
    [taskIds],
  )) as Total[];
  const [links] = (await tx.query(
    `SELECT count(*) AS count, ${boardRevisionSql(publicOnly, [
      "e.id",
      "e.task_id",
      "e.xmin::text",
    ])} AS revision
     FROM external_link e WHERE e.task_id = ANY($1::text[])`,
    [taskIds],
  )) as Total[];
  return {
    labelCount: Number(labels?.count ?? 0),
    linkCount: Number(links?.count ?? 0),
    labelRevision: labels?.revision ?? "0",
    linkRevision: links?.revision ?? "0",
  };
}

/**
 * Every public task page must detect edits to cards or metadata loaded on
 * earlier pages: labels and links of all filtered tasks, and the progress of
 * visible subtasks.
 */
export async function publicRelatedRevision(
  tx: EntityManager,
  filter: TaskFilter,
  workspaceId: string,
): Promise<string> {
  const [labels] = (await tx.query(
    `SELECT ${boardRevisionSql(true, ["l.id", "l.task_id", "l.name", "l.color"])} AS revision
     FROM label l INNER JOIN task t ON l.task_id = t.id
     WHERE ${filter.sql}`,
    filter.parameters,
  )) as { revision: string }[];
  const [links] = (await tx.query(
    `SELECT ${boardRevisionSql(true, ["e.id", "e.xmin::text"])} AS revision
     FROM external_link e INNER JOIN task t ON e.task_id = t.id
     WHERE ${filter.sql}`,
    filter.parameters,
  )) as { revision: string }[];
  const [children] = (await tx.query(
    `SELECT ${boardRevisionSql(true, ["r.id", "child.id", taskIsCompletedSql("child")])} AS revision
     FROM task_relation r
     INNER JOIN task board_parent ON r.source_task_id = board_parent.id
     INNER JOIN task child ON r.target_task_id = child.id
     INNER JOIN project p ON child.project_id = p.id
     WHERE board_parent.project_id = $1
       AND r.relation_type = 'subtask'
       AND p.workspace_id = $2
       AND p.is_public = true`,
    [filter.parameters[0], workspaceId],
  )) as { revision: string }[];
  return `${labels?.revision}:${links?.revision}:${children?.revision}`;
}
