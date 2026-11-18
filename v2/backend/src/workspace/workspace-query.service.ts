import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { instanceAdminRoleSql } from "../access/instance-admin-role";
import { HTTPException } from "../common/errors/http-exception";
import {
  WORKSPACE_ACCESS_COLUMNS_SQL,
  type WorkspaceAccess,
} from "./can-read-workspace";
import { filterReadableWorkspaces } from "./filter-readable-workspaces";
import {
  toWorkspaceResponse,
  WORKSPACE_COLUMNS_SQL,
  type WorkspaceRow,
} from "./to-workspace-response";

type Row = WorkspaceRow & WorkspaceAccess;

@Injectable()
export class WorkspaceQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** The caller's memberships, one row each: the earliest when duplicated. */
  async listWorkspaces(userId: string) {
    const manager = this.dataSource.manager;
    const rows = (await manager.query(
      `SELECT DISTINCT ON (lower(w.name), w.id)
         ${WORKSPACE_COLUMNS_SQL},
         ${WORKSPACE_ACCESS_COLUMNS_SQL}
       FROM workspace w
       INNER JOIN workspace_member m
         ON m.workspace_id = w.id AND m.user_id = $1
       INNER JOIN "user" u ON u.id = m.user_id
       ORDER BY lower(w.name), w.id, m.joined_at, m.id`,
      [userId],
    )) as Row[];

    return (await filterReadableWorkspaces(manager, rows)).map(
      toWorkspaceResponse,
    );
  }

  async getWorkspace(workspaceId: string, userId: string) {
    const manager = this.dataSource.manager;
    const rows = (await manager.query(
      `SELECT ${WORKSPACE_COLUMNS_SQL},
         ${WORKSPACE_ACCESS_COLUMNS_SQL}
       FROM workspace w
       INNER JOIN "user" u ON u.id = $2
       LEFT JOIN workspace_member m
         ON m.workspace_id = w.id AND m.user_id = u.id
       WHERE w.id = $1
         AND (m.id IS NOT NULL OR ${instanceAdminRoleSql("u.role")})
       ORDER BY m.joined_at, m.id
       LIMIT 1`,
      [workspaceId, userId],
    )) as Row[];

    const [row] = await filterReadableWorkspaces(manager, rows);
    if (!row) {
      throw new HTTPException(404, { message: "Workspace not found" });
    }

    return toWorkspaceResponse(row);
  }
}
