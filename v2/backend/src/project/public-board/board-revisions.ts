import type { EntityManager } from "typeorm";
import { boardRevision, sortValue, taskIsCompleted } from "./board-sql";
import type { PublicBoardOptions } from "./public-board-query";

type CountRow = { count: string; revision: string };

/** Filtered task count, and a revision over card content and order. */
export async function taskCountRevision(
  manager: EntityManager,
  filter: { where: string; parameters: unknown[] },
  sortBy: PublicBoardOptions["sortBy"],
): Promise<CountRow | undefined> {
  const [row] = (await manager.query(
    `SELECT count(*) AS count,
            ${boardRevision([
              "task.id",
              sortValue(sortBy),
              "task.status",
              // Row versions detect content edits without hashing descriptions.
              "task.xmin::text",
              '"user".name',
              '"user".image',
            ])} AS revision
     FROM task
     LEFT JOIN "user" ON task.assignee_id = "user".id
     WHERE ${filter.where}`,
    filter.parameters,
  )) as CountRow[];
  return row;
}

export async function columnCountRevision(
  manager: EntityManager,
  projectId: string,
): Promise<CountRow | undefined> {
  const [row] = (await manager.query(
    `SELECT count(*) AS count,
            ${boardRevision([
              '"column".id',
              '"column".slug',
              '"column".position',
              '"column".name',
              '"column".icon',
              '"column".is_final',
            ])} AS revision
     FROM "column" WHERE project_id = $1`,
    [projectId],
  )) as CountRow[];
  return row;
}

/** Counts and revisions of the labels and links on a page of tasks. */
export async function relatedCountRevisions(
  manager: EntityManager,
  taskIds: string[],
) {
  if (!taskIds.length)
    return {
      labelCount: 0,
      linkCount: 0,
      labelRevision: "0",
      linkRevision: "0",
    };
  const [labels] = (await manager.query(
    `SELECT count(*) AS count,
            ${boardRevision([
              "label.id",
              "label.task_id",
              "label.name",
              "label.color",
            ])} AS revision
     FROM label WHERE label.task_id = ANY($1::text[])`,
    [taskIds],
  )) as CountRow[];
  const [links] = (await manager.query(
    `SELECT count(*) AS count,
            ${boardRevision([
              "external_link.id",
              "external_link.task_id",
              "external_link.xmin::text",
            ])} AS revision
     FROM external_link WHERE external_link.task_id = ANY($1::text[])`,
    [taskIds],
  )) as CountRow[];
  return {
    labelCount: Number(labels?.count ?? 0),
    linkCount: Number(links?.count ?? 0),
    labelRevision: labels?.revision ?? "0",
    linkRevision: links?.revision ?? "0",
  };
}

/**
 * Every task page must detect edits to cards or metadata loaded earlier:
 * labels and links of all filtered tasks, and visible subtask progress.
 */
export async function publicRelatedRevision(
  manager: EntityManager,
  filter: { where: string; parameters: unknown[] },
  projectId: string,
  workspaceId: string,
): Promise<string> {
  const [labels] = (await manager.query(
    `SELECT ${boardRevision([
      "label.id",
      "label.task_id",
      "label.name",
      "label.color",
    ])} AS revision
     FROM label INNER JOIN task ON label.task_id = task.id
     WHERE ${filter.where}`,
    filter.parameters,
  )) as { revision: string }[];
  const [links] = (await manager.query(
    `SELECT ${boardRevision([
      "external_link.id",
      "external_link.xmin::text",
    ])} AS revision
     FROM external_link INNER JOIN task ON external_link.task_id = task.id
     WHERE ${filter.where}`,
    filter.parameters,
  )) as { revision: string }[];
  const [children] = (await manager.query(
    `SELECT ${boardRevision([
      "task_relation.id",
      "task.id",
      taskIsCompleted,
    ])} AS revision
     FROM task_relation
     INNER JOIN task AS board_parent
       ON task_relation.source_task_id = board_parent.id
     INNER JOIN task ON task_relation.target_task_id = task.id
     INNER JOIN project ON task.project_id = project.id
     WHERE board_parent.project_id = $1
       AND task_relation.relation_type = 'subtask'
       AND project.workspace_id = $2
       AND project.is_public = true`,
    [projectId, workspaceId],
  )) as { revision: string }[];
  return `${labels?.revision}:${links?.revision}:${children?.revision}`;
}
