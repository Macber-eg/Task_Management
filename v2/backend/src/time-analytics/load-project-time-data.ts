import type { EntityManager } from "typeorm";
import { ProjectPhaseEntity } from "../database/entities/project-phase.entity";
import { ProjectSprintEntity } from "../database/entities/project-sprint.entity";

export type ProjectTaskRow = {
  id: string;
  title: string;
  number: number | null;
  status: string;
  phaseId: string | null;
  sprintId: string | null;
  estimatedMinutes: number | null;
  userId: string | null;
};

/**
 * A project's tasks with their estimates, logged seconds (closed entries
 * only) and subtask tree, plus its phases and sprints. Undefined when the
 * project does not exist.
 */
export async function loadProjectTimeData(
  manager: EntityManager,
  projectId: string,
) {
  const [project] = (await manager.query(
    `SELECT id, workspace_id AS "workspaceId", name
     FROM project WHERE id = $1 LIMIT 1`,
    [projectId],
  )) as { id: string; workspaceId: string; name: string }[];

  if (!project) return null;

  const tasks = (await manager.query(
    `SELECT id, title, number, status, phase_id AS "phaseId",
       sprint_id AS "sprintId", estimated_minutes AS "estimatedMinutes",
       assignee_id AS "userId"
     FROM task WHERE project_id = $1`,
    [projectId],
  )) as ProjectTaskRow[];

  const taskIds = tasks.map((task) => task.id);
  const relations =
    taskIds.length > 0
      ? ((await manager.query(
          `SELECT source_task_id AS "parentId", target_task_id AS "childId"
           FROM task_relation
           WHERE relation_type = 'subtask'
             AND source_task_id = ANY($1::text[])
             AND target_task_id = ANY($1::text[])`,
          [taskIds],
        )) as { parentId: string; childId: string }[])
      : [];

  const subtasksByParentId = new Map<string, string[]>();
  for (const relation of relations) {
    const list = subtasksByParentId.get(relation.parentId) ?? [];
    list.push(relation.childId);
    subtasksByParentId.set(relation.parentId, list);
  }

  const actualRows =
    taskIds.length > 0
      ? ((await manager.query(
          `SELECT task_id AS "taskId", coalesce(sum(duration), 0) AS "totalSeconds"
           FROM time_entry
           WHERE task_id = ANY($1::text[]) AND end_time IS NOT NULL
           GROUP BY task_id`,
          [taskIds],
        )) as { taskId: string; totalSeconds: string | number }[])
      : [];

  const actualByTaskId = new Map<string, number>();
  for (const row of actualRows) {
    actualByTaskId.set(row.taskId, Number(row.totalSeconds) || 0);
  }

  const estimatedByTaskId = new Map<string, number | null>();
  for (const task of tasks) {
    estimatedByTaskId.set(task.id, task.estimatedMinutes);
  }

  const phases = await manager.find(ProjectPhaseEntity, {
    where: { projectId },
  });

  const sprints = await manager.find(ProjectSprintEntity, {
    where: { projectId },
  });

  return {
    project,
    tasks,
    phases,
    sprints,
    subtasksByParentId,
    actualByTaskId,
    estimatedByTaskId,
  };
}
