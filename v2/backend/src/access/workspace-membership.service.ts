import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { hasInstanceAdminRole } from "./instance-admin-role";

type ValidateWorkspaceAccessOptions = {
  notFoundMessage?: string;
};

@Injectable()
export class WorkspaceMembershipService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Passes when the user belongs to the workspace, or is an instance admin
   * and the workspace exists. A non-member gets the same 404 as a missing
   * workspace, so membership cannot be probed.
   */
  async validateWorkspaceAccess(
    userId: string,
    workspaceId: string,
    apiKeyId?: string,
    options: ValidateWorkspaceAccessOptions = {},
  ): Promise<void> {
    if (apiKeyId) {
      const apiKeys = (await this.dataSource.query(
        `SELECT 1 FROM apikey
         WHERE id = $1 AND (reference_id = $2 OR user_id = $2) AND enabled = true
         LIMIT 1`,
        [apiKeyId, userId],
      )) as unknown[];

      if (apiKeys.length === 0) {
        throw new HTTPException(403, {
          message: "Invalid API key for this workspace",
        });
      }
    }

    const notFound = () =>
      new HTTPException(404, {
        message: options.notFoundMessage ?? "Workspace not found",
      });

    const [user] = (await this.dataSource.query(
      `SELECT role FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { role: string | null }[];

    if (hasInstanceAdminRole(user?.role)) {
      const workspaces = (await this.dataSource.query(
        "SELECT 1 FROM workspace WHERE id = $1 LIMIT 1",
        [workspaceId],
      )) as unknown[];
      if (workspaces.length === 0) throw notFound();
      return;
    }

    const memberships = (await this.dataSource.query(
      `SELECT 1 FROM workspace_member
       WHERE user_id = $1 AND workspace_id = $2 LIMIT 1`,
      [userId, workspaceId],
    )) as unknown[];

    if (memberships.length === 0) throw notFound();
  }
}
