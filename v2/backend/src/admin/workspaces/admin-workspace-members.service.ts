import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { DEFAULT_ROLE_NAMES } from "../../permissions";

type MemberRow = {
  user_id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joined_at: Date;
};

async function assertWorkspaceExists(
  manager: EntityManager,
  workspaceId: string,
) {
  const rows = (await manager.query(
    "SELECT id FROM workspace WHERE id = $1 LIMIT 1",
    [workspaceId],
  )) as unknown[];
  if (rows.length === 0) {
    throw new HTTPException(404, { message: "Workspace not found" });
  }
}

/** What an administrator sees of a workspace they need not belong to. */
@Injectable()
export class AdminWorkspaceMembersService {
  constructor(private readonly dataSource: DataSource) {}

  async listMembers(workspaceId: string) {
    const manager = this.dataSource.manager;
    await assertWorkspaceExists(manager, workspaceId);
    const rows = (await manager.query(
      `SELECT u.id AS user_id, u.name, u.email, u.image, member.role, member.joined_at
       FROM workspace_member AS member
       JOIN "user" AS u ON member.user_id = u.id
       WHERE member.workspace_id = $1
       ORDER BY member.joined_at ASC, u.id ASC`,
      [workspaceId],
    )) as MemberRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      image: row.image,
      role: row.role,
      joinedAt: row.joined_at.toISOString(),
    }));
  }

  /** The built-in roles plus the workspace's custom ones; never `owner`. */
  async listAssignableRoles(workspaceId: string): Promise<string[]> {
    const manager = this.dataSource.manager;
    await assertWorkspaceExists(manager, workspaceId);
    const custom = (await manager.query(
      "SELECT role FROM workspace_role WHERE workspace_id = $1 ORDER BY role ASC",
      [workspaceId],
    )) as { role: string }[];

    return [
      ...new Set([
        ...DEFAULT_ROLE_NAMES,
        ...custom.map((row) => row.role).filter((role) => role !== "owner"),
      ]),
    ];
  }
}
