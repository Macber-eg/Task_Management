import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { escapeLikePattern } from "./escape-like-pattern";

type UserRow = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  created_at: Date;
  updated_at: Date;
  role: string | null;
  banned: boolean | null;
  ban_reason: string | null;
  ban_expires: Date | null;
};

@Injectable()
export class AdminUserQueryService {
  constructor(private readonly dataSource: DataSource) {}

  /** A page of every account, newest first, optionally searched by name or email. */
  async listUsers({
    search,
    page,
    limit,
  }: {
    search?: string;
    page: number;
    limit: number;
  }) {
    const term = search?.trim() ?? "";
    const where = term ? "WHERE name ILIKE $1 OR email ILIKE $1" : "";
    const params = term ? [`%${escapeLikePattern(term)}%`] : [];

    const [rows, [total]] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name, email, email_verified, image, created_at, updated_at,
                role, banned, ban_reason, ban_expires
         FROM "user" ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit],
      ) as Promise<UserRow[]>,
      this.dataSource.query(
        `SELECT count(*)::int AS value FROM "user" ${where}`,
        params,
      ) as Promise<{ value: number }[]>,
    ]);

    return {
      users: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.email_verified,
        image: row.image,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        role: row.role,
        banned: row.banned ?? false,
        banReason: row.ban_reason,
        banExpires: row.ban_expires ? row.ban_expires.toISOString() : null,
      })),
      total: total?.value ?? 0,
    };
  }
}
