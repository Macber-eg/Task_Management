import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { boundedTaskRead } from "../bounded-task-read";
import {
  boardDescriptionSql,
  descriptionDeferredSql,
} from "../description-sql";
import { getSubtaskCounts } from "../subtask-counts";
import { boardTaskFilter, type GetTasksOptions } from "./board-options";
import {
  loadBoardColumns,
  loadTaskExternalLinks,
  loadTaskLabels,
  RELATED_PAGE_SIZE,
} from "./board-related-rows";
import {
  countBoardColumns,
  countBoardTasks,
  countTaskPageRelated,
  publicRelatedRevision,
} from "./board-totals";
import { sortValueSql } from "./task-sort";

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

const BOARD_TASK_COLUMNS = `t.id, t.title, t.number,
  ${boardDescriptionSql("t.description")} AS description,
  ${descriptionDeferredSql("t.description")} AS "descriptionDeferred",
  t.status, t.priority, t.start_date AS "startDate", t.due_date AS "dueDate",
  t.estimated_minutes AS "estimatedMinutes", t.position,
  t.created_at AS "createdAt", t.assignee_id AS "userId",
  u.name AS "assigneeName", u.id AS "assigneeId", u.image AS "assigneeImage",
  t.project_id AS "projectId", t.phase_id AS "phaseId", t.sprint_id AS "sprintId"`;

/**
 * A project's board in bounded pages: its columns with their tasks, and the
 * planned and archived buckets. Public boards also report revisions so a
 * reader can tell when the board changed between pages.
 */
@Injectable()
export class BoardQueryService {
  constructor(private readonly dataSource: DataSource) {}

  getTasks(projectId: string, options: GetTasksOptions = {}, userId?: string) {
    return boundedTaskRead(
      this.dataSource,
      (tx) => this.getTasksPage(tx, projectId, options, userId),
      "Task list request took too long; retry later",
    );
  }

  private async findProject(
    tx: EntityManager,
    projectId: string,
    publicOnly: boolean | undefined,
  ): Promise<BoardProject> {
    const [project] = (await tx.query(
      `SELECT p.id, p.name, p.slug, p.icon,
         ${boardDescriptionSql("p.description")} AS description,
         ${descriptionDeferredSql("p.description")} AS "descriptionDeferred",
         p.is_public AS "isPublic", p.workspace_id AS "workspaceId",
         p.background_version AS "backgroundVersion",
         p.phases_enabled AS "phasesEnabled", p.sprints_enabled AS "sprintsEnabled",
         p.start_date AS "startDate", p.end_date AS "endDate",
         ${publicOnly ? "p.xmin::text" : "'0'"} AS revision
       FROM project p WHERE p.id = $1 LIMIT 1`,
      [projectId],
    )) as BoardProject[];

    if (!project) {
      throw new HTTPException(404, {
        message: "Project not found",
      });
    }
    return project;
  }

  private async getTasksPage(
    tx: EntityManager,
    projectId: string,
    options: GetTasksOptions,
    userId?: string,
  ) {
    const project = await this.findProject(tx, projectId, options.publicOnly);
    const filter = boardTaskFilter(projectId, options);
    const page = options.page && options.page > 0 ? options.page : 1;
    const pageSize =
      options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
    const offset = (page - 1) * pageSize;
    const relatedPage = options.relatedPage ?? 1;
    const relatedOffset = (relatedPage - 1) * RELATED_PAGE_SIZE;
    const sortValue = sortValueSql(options.sortBy ?? "position");
    const sortOrder = (options.sortOrder ?? "asc") === "desc" ? "desc" : "asc";

    const taskCount = await countBoardTasks(
      tx,
      filter,
      options.publicOnly,
      options.sortBy,
    );
    const total = Number(taskCount?.count ?? 0);

    const paginatedTasks = (await tx.query(
      `SELECT ${BOARD_TASK_COLUMNS}
       FROM task t
       LEFT JOIN "user" u ON t.assignee_id = u.id
       WHERE ${filter.sql}
       ORDER BY ${sortValue} ${sortOrder}, t.id asc
       LIMIT ${pageSize} OFFSET ${offset}`,
      filter.parameters,
    )) as BoardTaskRow[];
    const taskIds = paginatedTasks.map((task) => task.id);

    const subtaskCounts = await getSubtaskCounts(
      tx,
      taskIds,
      project.workspaceId,
      options.publicOnly ?? false,
      userId,
    );
    const taskLabels = await loadTaskLabels(tx, taskIds, relatedOffset);
    const taskLinks = await loadTaskExternalLinks(tx, taskIds, relatedOffset);
    const projectColumns = await loadBoardColumns(
      tx,
      projectId,
      relatedOffset,
      paginatedTasks.map((task) => task.status),
    );
    const columnCount = await countBoardColumns(
      tx,
      projectId,
      options.publicOnly,
    );
    const related = await countTaskPageRelated(tx, taskIds, options.publicOnly);
    const relatedRevision = options.publicOnly
      ? await publicRelatedRevision(tx, filter, project.workspaceId)
      : "0";

    const withRelated = (task: BoardTaskRow) => ({
      ...task,
      subtaskCounts: subtaskCounts.get(task.id) ?? { completed: 0, total: 0 },
      labels: taskLabels.get(task.id) || [],
      externalLinks: taskLinks.get(task.id) || [],
    });
    const tasksIn = (status: string) =>
      paginatedTasks.filter((task) => task.status === status).map(withRelated);

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
        columns: projectColumns.map((column) => ({
          id: column.slug,
          slug: column.slug,
          name: column.name,
          position: column.position,
          icon: column.icon,
          isFinal: column.isFinal,
          tasks: tasksIn(column.slug),
        })),
        archivedTasks: tasksIn("archived"),
        plannedTasks: tasksIn("planned"),
      },
      pagination: {
        total,
        ...(options.publicOnly
          ? {
              revision: `${project.revision}:${total}:${taskCount?.revision}:${columnCount?.count}:${columnCount?.revision}:${relatedRevision}`,
              relatedRevision: `${related.labelCount}:${related.labelRevision}:${related.linkCount}:${related.linkRevision}`,
            }
          : {}),
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
}
