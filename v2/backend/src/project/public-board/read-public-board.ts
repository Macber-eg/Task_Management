import type { EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import {
  boardColumns,
  externalLinksByTask,
  labelsByTask,
  RELATED_PAGE_SIZE,
} from "./board-related-rows";
import {
  columnCountRevision,
  publicRelatedRevision,
  relatedCountRevisions,
  taskCountRevision,
} from "./board-revisions";
import {
  boardDescription,
  descriptionDeferred,
  sortValue,
  taskFilter,
} from "./board-sql";
import type { PublicBoardOptions } from "./public-board-query";
import { getPublicSubtaskCounts } from "./public-subtask-counts";

type BoardProject = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  descriptionDeferred: boolean;
  isPublic: boolean | null;
  workspaceId: string;
  backgroundVersion: string | null;
  phasesEnabled: boolean;
  sprintsEnabled: boolean;
  startDate: Date | null;
  endDate: Date | null;
  revision: string;
};

type BoardTaskRow = { id: string; status: string } & Record<string, unknown>;

async function findBoardProject(manager: EntityManager, projectId: string) {
  const [project] = (await manager.query(
    `SELECT id, name, slug, icon,
            ${boardDescription("project")} AS description,
            ${descriptionDeferred("project")} AS "descriptionDeferred",
            is_public AS "isPublic", workspace_id AS "workspaceId",
            background_version AS "backgroundVersion",
            phases_enabled AS "phasesEnabled",
            sprints_enabled AS "sprintsEnabled",
            start_date AS "startDate", end_date AS "endDate",
            project.xmin::text AS revision
     FROM project WHERE id = $1 LIMIT 1`,
    [projectId],
  )) as BoardProject[];
  return project;
}

async function findTaskPage(
  manager: EntityManager,
  filter: { where: string; parameters: unknown[] },
  options: PublicBoardOptions,
  pageSize: number,
  offset: number,
): Promise<BoardTaskRow[]> {
  const direction = (options.sortOrder ?? "asc") === "desc" ? "DESC" : "ASC";
  const next = filter.parameters.length + 1;
  return (await manager.query(
    `SELECT task.id, task.title, task.number,
            ${boardDescription("task")} AS description,
            ${descriptionDeferred("task")} AS "descriptionDeferred",
            task.status, task.priority,
            task.start_date AS "startDate", task.due_date AS "dueDate",
            task.estimated_minutes AS "estimatedMinutes", task.position,
            task.created_at AS "createdAt", task.assignee_id AS "userId",
            "user".name AS "assigneeName", "user".id AS "assigneeId",
            "user".image AS "assigneeImage", task.project_id AS "projectId",
            task.phase_id AS "phaseId", task.sprint_id AS "sprintId"
     FROM task
     LEFT JOIN "user" ON task.assignee_id = "user".id
     LEFT JOIN project ON task.project_id = project.id
     WHERE ${filter.where}
     ORDER BY ${sortValue(options.sortBy ?? "position")} ${direction}, task.id ASC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...filter.parameters, pageSize, offset],
  )) as BoardTaskRow[];
}

/**
 * One page of a public board: tasks by column with their labels, links and
 * subtask progress, and revisions that let the reader detect changes between
 * pages. Run inside a bounded read.
 */
export async function readPublicBoard(
  manager: EntityManager,
  projectId: string,
  options: PublicBoardOptions,
) {
  const project = await findBoardProject(manager, projectId);
  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const filter = taskFilter(projectId, options);
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;
  const relatedPage = options.relatedPage ?? 1;
  const relatedOffset = (relatedPage - 1) * RELATED_PAGE_SIZE;

  const taskCount = await taskCountRevision(manager, filter, options.sortBy);
  const total = Number(taskCount?.count ?? 0);

  const tasks = await findTaskPage(manager, filter, options, pageSize, offset);
  const taskIds = tasks.map((task) => task.id);

  const subtaskCounts = await getPublicSubtaskCounts(
    manager,
    taskIds,
    project.workspaceId,
  );
  const labels = await labelsByTask(manager, taskIds, relatedOffset);
  const externalLinks = await externalLinksByTask(
    manager,
    taskIds,
    relatedOffset,
  );
  const columns = await boardColumns(
    manager,
    projectId,
    relatedOffset,
    tasks.map((task) => task.status),
  );
  const columnCount = await columnCountRevision(manager, projectId);
  const related = await relatedCountRevisions(manager, taskIds);
  const relatedRevision = await publicRelatedRevision(
    manager,
    filter,
    projectId,
    project.workspaceId,
  );

  const toBoardTask = (task: BoardTaskRow) => ({
    ...task,
    subtaskCounts: subtaskCounts.get(task.id) ?? { completed: 0, total: 0 },
    labels: labels.get(task.id) || [],
    externalLinks: externalLinks.get(task.id) || [],
  });
  const withStatus = (status: string) =>
    tasks.filter((task) => task.status === status).map(toBoardTask);

  return {
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      description: project.description,
      descriptionDeferred: project.descriptionDeferred,
      isPublic: project.isPublic,
      workspaceId: project.workspaceId,
      backgroundVersion: project.backgroundVersion,
      phasesEnabled: project.phasesEnabled,
      sprintsEnabled: project.sprintsEnabled,
      startDate: project.startDate,
      endDate: project.endDate,
      columns: columns.map((column) => ({
        id: column.slug,
        slug: column.slug,
        name: column.name,
        position: column.position,
        icon: column.icon,
        isFinal: column.isFinal,
        tasks: withStatus(column.slug),
      })),
      archivedTasks: withStatus("archived"),
      plannedTasks: withStatus("planned"),
    },
    pagination: {
      total,
      revision: `${project.revision}:${total}:${taskCount?.revision}:${columnCount?.count}:${columnCount?.revision}:${relatedRevision}`,
      relatedRevision: `${related.labelCount}:${related.labelRevision}:${related.linkCount}:${related.linkRevision}`,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      relatedPage,
      relatedPageSize: RELATED_PAGE_SIZE,
      relatedTotalPages: Math.max(
        1,
        Math.ceil(
          Math.max(
            Number(columnCount?.count ?? 0),
            related.labelCount,
            related.linkCount,
          ) / RELATED_PAGE_SIZE,
        ),
      ),
    },
  };
}
