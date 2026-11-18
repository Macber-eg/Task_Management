import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { escapeLikePattern } from "../users/escape-like-pattern";

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
};

type OwnerRow = {
  workspace_id: string;
  id: string;
  name: string;
  email: string;
};

type CountRow = { workspace_id: string; value: number };

@Injectable()
export class AdminWorkspaceQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** A page of every workspace, newest first, with owners and counts. */
  async listWorkspaces({
    search,
    page,
    limit,
  }: {
    search?: string;
    page: number;
    limit: number;
  }) {
    const term = search?.trim() ?? "";
    const where = term ? "WHERE name ILIKE $1 OR slug ILIKE $1" : "";
    const params = term ? [`%${escapeLikePattern(term)}%`] : [];

    const [rows, [total]] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name, slug, created_at FROM workspace ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ) as Promise<WorkspaceRow[]>,
      this.dataSource.query(
        `SELECT count(*)::int AS value FROM workspace ${where}`,
        params,
      ) as Promise<{ value: number }[]>,
    ]);

    if (rows.length === 0) {
      return { workspaces: [], total: total?.value ?? 0 };
    }

    const workspaceIds = rows.map((row) => row.id);
    const [owners, memberCounts, projectCounts] = await Promise.all([
      this.dataSource.query(
        `SELECT member.workspace_id, u.id, u.name, u.email
         FROM workspace_member AS member
         JOIN "user" AS u ON member.user_id = u.id
         WHERE member.workspace_id = ANY($1::text[])
           AND 'owner' = any(string_to_array(member.role, ','))`,
        [workspaceIds],
      ) as Promise<OwnerRow[]>,
      this.dataSource.query(
        `SELECT workspace_id, count(*)::int AS value FROM workspace_member
         WHERE workspace_id = ANY($1::text[]) GROUP BY workspace_id`,
        [workspaceIds],
      ) as Promise<CountRow[]>,
      this.dataSource.query(
        `SELECT workspace_id, count(*)::int AS value FROM project
         WHERE workspace_id = ANY($1::text[]) GROUP BY workspace_id`,
        [workspaceIds],
      ) as Promise<CountRow[]>,
    ]);

    const members = new Map(
      memberCounts.map((row) => [row.workspace_id, row.value]),
    );
    const projects = new Map(
      projectCounts.map((row) => [row.workspace_id, row.value]),
    );

    return {
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        createdAt: row.created_at.toISOString(),
        memberCount: members.get(row.id) ?? 0,
        projectCount: projects.get(row.id) ?? 0,
        owners: owners
          .filter((owner) => owner.workspace_id === row.id)
          .map(({ id, name, email }) => ({ id, name, email })),
      })),
      total: total?.value ?? 0,
    };
  }
}
