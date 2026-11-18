import type { EntityManager } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";

export type ProjectStatistics = {
  completionPercentage: number;
  totalTasks: number;
  dueDate: Date | null;
};

export const EMPTY_STATISTICS: ProjectStatistics = {
  completionPercentage: 0,
  totalTasks: 0,
  dueDate: null,
};

type StatisticsRow = {
  projectId: string;
  totalTasks: string;
  completedTasks: string;
  dueDate: Date | null;
};

/**
 * Task rollups for every project the user may see in a workspace, computed in
 * the database so the list never loads task rows. Scoped by a join on the
 * workspace, so the statement size does not grow with the project count.
 */
export async function getProjectStatistics(
  manager: EntityManager,
  workspaceId: string,
  userId: string,
  includeArchived: boolean,
): Promise<Map<string, ProjectStatistics>> {
  const rows = (await manager.query(
    `SELECT task.project_id AS "projectId",
            count(*) AS "totalTasks",
            count(CASE WHEN task.status IN ('done', 'archived') THEN 1 END)
              AS "completedTasks",
            min(task.due_date) AS "dueDate"
     FROM task
     INNER JOIN project ON task.project_id = project.id
     WHERE project.workspace_id = $1
       ${includeArchived ? "" : "AND project.archived_at IS NULL"}
     GROUP BY task.project_id
     HAVING ${projectAccessCondition("$2", "task.project_id")}`,
    [workspaceId, userId],
  )) as StatisticsRow[];

  const statisticsByProject = new Map<string, ProjectStatistics>();
  for (const row of rows) {
    const totalTasks = Number(row.totalTasks);
    const completedTasks = Number(row.completedTasks);

    statisticsByProject.set(row.projectId, {
      totalTasks,
      completionPercentage:
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      dueDate: row.dueDate ?? null,
    });
  }

  return statisticsByProject;
}
