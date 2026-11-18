import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

export type LookupResource =
  | "project"
  | "task"
  | "label"
  | "timeEntry"
  | "activity"
  | "comment"
  | "column"
  | "projectPhase"
  | "projectSprint"
  | "workflowRule"
  | "customField";

export type ResourceScope = { workspaceId: string; projectId: string | null };

const SCOPE_COLUMNS = `p.workspace_id AS "workspaceId", p.id AS "projectId"`;

/** Resources that reach their project through one join (or are the project). */
const PROJECT_SCOPED_SQL: Record<Exclude<LookupResource, "label">, string> = {
  project: `SELECT ${SCOPE_COLUMNS} FROM project p WHERE p.id = $1 LIMIT 1`,
  task: `SELECT ${SCOPE_COLUMNS} FROM task t
         JOIN project p ON t.project_id = p.id WHERE t.id = $1 LIMIT 1`,
  timeEntry: `SELECT ${SCOPE_COLUMNS} FROM time_entry te
              JOIN task t ON te.task_id = t.id
              JOIN project p ON t.project_id = p.id WHERE te.id = $1 LIMIT 1`,
  activity: `SELECT ${SCOPE_COLUMNS} FROM activity a
             JOIN task t ON a.task_id = t.id
             JOIN project p ON t.project_id = p.id WHERE a.id = $1 LIMIT 1`,
  comment: `SELECT ${SCOPE_COLUMNS} FROM activity a
            JOIN task t ON a.task_id = t.id
            JOIN project p ON t.project_id = p.id
            WHERE a.id = $1 AND a.type = 'comment' LIMIT 1`,
  column: `SELECT ${SCOPE_COLUMNS} FROM "column" c
           JOIN project p ON c.project_id = p.id WHERE c.id = $1 LIMIT 1`,
  projectPhase: `SELECT ${SCOPE_COLUMNS} FROM project_phase ph
                 JOIN project p ON ph.project_id = p.id WHERE ph.id = $1 LIMIT 1`,
  projectSprint: `SELECT ${SCOPE_COLUMNS} FROM project_sprint s
                  JOIN project p ON s.project_id = p.id WHERE s.id = $1 LIMIT 1`,
  workflowRule: `SELECT ${SCOPE_COLUMNS} FROM workflow_rule w
                 JOIN project p ON w.project_id = p.id WHERE w.id = $1 LIMIT 1`,
  customField: `SELECT ${SCOPE_COLUMNS} FROM custom_field_definition f
                JOIN project p ON f.project_id = p.id WHERE f.id = $1 LIMIT 1`,
};

type LabelScopeRow = {
  workspaceId: string | null;
  taskId: string | null;
  taskWorkspaceId: string | null;
  taskProjectId: string | null;
};

/** Finds which workspace and project a resource id belongs to. */
@Injectable()
export class WorkspaceScopeService {
  constructor(private readonly dataSource: DataSource) {}

  async lookupScope(
    resource: LookupResource,
    id: string,
  ): Promise<ResourceScope | null> {
    if (resource === "label") return this.lookupLabelScope(id);

    const [row] = (await this.dataSource.query(PROJECT_SCOPED_SQL[resource], [
      id,
    ])) as ResourceScope[];
    return row ?? null;
  }

  /** Scopes of several tasks, one row per task that exists. */
  async lookupTaskScopes(
    taskIds: readonly string[],
  ): Promise<{ workspaceId: string; projectId: string }[]> {
    return (await this.dataSource.query(
      `SELECT ${SCOPE_COLUMNS} FROM task t
       JOIN project p ON t.project_id = p.id
       WHERE t.id = ANY($1::text[])`,
      [taskIds],
    )) as { workspaceId: string; projectId: string }[];
  }

  private async lookupLabelScope(id: string): Promise<ResourceScope | null> {
    const [label] = (await this.dataSource.query(
      `SELECT l.workspace_id AS "workspaceId", l.task_id AS "taskId",
              p.workspace_id AS "taskWorkspaceId", p.id AS "taskProjectId"
       FROM label l
       LEFT JOIN task t ON l.task_id = t.id
       LEFT JOIN project p ON t.project_id = p.id
       WHERE l.id = $1 LIMIT 1`,
      [id],
    )) as LabelScopeRow[];

    const labelOutsideTaskWorkspace =
      label?.taskId && label.taskWorkspaceId !== label.workspaceId;
    if (labelOutsideTaskWorkspace || !label?.workspaceId) return null;
    return {
      workspaceId: label.workspaceId,
      projectId: label.taskProjectId ?? null,
    };
  }
}
