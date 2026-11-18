import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
  hasInstanceAdminRole,
  instanceAdminRoleSql,
} from "../access/instance-admin-role";
import { projectAccessCondition } from "../access/project-access-condition";
import { ProjectAccessService } from "../access/project-access.service";

type ProjectRef = { projectId: string };

/** The reads the WebSocket layer makes to decide who may still listen. */
@Injectable()
export class RealtimeAccessReader {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async projectWorkspaceId(projectId: string): Promise<string | null> {
    const [project] = (await this.dataSource.query(
      "SELECT workspace_id FROM project WHERE id = $1 LIMIT 1",
      [projectId],
    )) as { workspace_id: string }[];
    return project?.workspace_id ?? null;
  }

  async workspaceMemberIds(
    workspaceId: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `SELECT user_id FROM workspace_member
       WHERE workspace_id = $1 AND user_id = ANY($2::text[])`,
      [workspaceId, userIds],
    )) as { user_id: string }[];
    return rows.map((row) => row.user_id);
  }

  async usersWithProjectAccess(
    userIds: readonly string[],
    projectId: string,
  ): Promise<Set<string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Set();
    const rows = (await this.dataSource.query(
      `SELECT u.id FROM "user" AS u
       WHERE u.id = ANY($1::text[])
         AND ${projectAccessCondition("u.id", "$2")}`,
      [ids, projectId],
    )) as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  async instanceAdminIds(userIds: readonly string[]): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `SELECT id FROM "user"
       WHERE id = ANY($1::text[]) AND ${instanceAdminRoleSql("role")}`,
      [userIds],
    )) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** The user's instance role, or null when the user no longer exists. */
  async userRole(userId: string): Promise<{ role: string | null } | null> {
    const [user] = (await this.dataSource.query(
      `SELECT role FROM "user" WHERE id = $1`,
      [userId],
    )) as { role: string | null }[];
    return user ?? null;
  }

  async hasWorkspaceAccess(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const [user, members] = await Promise.all([
      this.userRole(userId),
      this.workspaceMemberIds(workspaceId, [userId]),
    ]);
    return !!user && (hasInstanceAdminRole(user.role) || members.length > 0);
  }

  /**
   * Every workspace the user can open, or null when the user is gone.
   * Instance admins get every existing workspace, not an "unrestricted"
   * marker, so a workspace deleted while they were offline is dropped too.
   */
  async accessibleWorkspaceIds(userId: string): Promise<string[] | null> {
    const user = await this.userRole(userId);
    if (!user) return null;
    const rows = hasInstanceAdminRole(user.role)
      ? ((await this.dataSource.query("SELECT id AS workspace_id FROM workspace")) as {
          workspace_id: string;
        }[])
      : ((await this.dataSource.query(
          "SELECT workspace_id FROM workspace_member WHERE user_id = $1",
          [userId],
        )) as { workspace_id: string }[]);
    return rows.map((row) => row.workspace_id);
  }

  findInaccessibleProjectIds(
    userId: string,
    projectIds: readonly string[],
  ): Promise<string[]> {
    return this.projectAccess.findInaccessibleProjectIds(userId, projectIds);
  }

  async workspaceProjectIds(workspaceId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      "SELECT id FROM project WHERE workspace_id = $1",
      [workspaceId],
    )) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** Boards whose subtask counters depend on these tasks, in any project. */
  async subtaskParentProjects(taskIds: readonly string[]): Promise<ProjectRef[]> {
    if (taskIds.length === 0) return [];
    return (await this.dataSource.query(
      `SELECT DISTINCT parent.project_id AS "projectId"
       FROM task_relation AS relation
       JOIN task AS parent ON relation.source_task_id = parent.id
       WHERE relation.target_task_id = ANY($1::text[])
         AND relation.relation_type = 'subtask'`,
      [taskIds],
    )) as ProjectRef[];
  }

  /** A deleted relation is gone by broadcast time; its source task is not. */
  async relationSourceProjects(sourceTaskId: string): Promise<ProjectRef[]> {
    return (await this.dataSource.query(
      `SELECT project_id AS "projectId" FROM task WHERE id = $1`,
      [sourceTaskId],
    )) as ProjectRef[];
  }
}
