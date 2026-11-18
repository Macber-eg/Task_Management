import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { findMember } from "../lookups/find-member";
import { findWorkspaceBySlug } from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import {
  type MemberWithUser,
  memberWithUserOutput,
} from "../output/member-output";
import {
  type MemberFilter,
  memberColumn,
  memberFilterSql,
} from "./member-list-sql";

const DEFAULT_LIMIT = 100;

export type WorkspaceSelector = {
  organizationId?: string;
  organizationSlug?: string;
};

export type MemberListOptions = {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  filter?: MemberFilter;
};

@Injectable()
export class MemberQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async listMembers(
    caller: OrganizationCaller,
    selector: WorkspaceSelector,
    options: MemberListOptions,
  ): Promise<{ members: MemberWithUser[]; total: number }> {
    const workspaceId = await this.memberWorkspace(caller, selector);

    const params: unknown[] = [workspaceId];
    let where = "workspace_id = $1";
    if (options.filter) {
      const condition = memberFilterSql(options.filter, 2);
      where += ` AND ${condition.sql}`;
      params.push(condition.value);
    }
    const order = options.sortBy
      ? ` ORDER BY ${memberColumn(options.sortBy)} ${options.sortDirection === "desc" ? "DESC" : "ASC"}`
      : "";
    const limit = options.limit || DEFAULT_LIMIT;
    const offset = options.offset || 0;

    const [rows, counted] = await Promise.all([
      this.dataSource.query(
        `SELECT id FROM workspace_member WHERE ${where}${order}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ) as Promise<{ id: string }[]>,
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM workspace_member WHERE ${where}`,
        params,
      ) as Promise<{ total: number }[]>,
    ]);

    const loaded = await this.dataSource.manager.find(WorkspaceUserEntity, {
      where: { id: In(rows.map((row) => row.id)) },
      relations: { user: true },
    });
    const byId = new Map(loaded.map((member) => [member.id, member]));
    const members = rows.flatMap(({ id }) => {
      const found = byId.get(id);
      if (!found?.user) return [];
      const { user, ...member } = found;
      return [memberWithUserOutput(member, user)];
    });
    return { members, total: counted[0]?.total ?? 0 };
  }

  async activeMember(caller: OrganizationCaller): Promise<MemberWithUser> {
    const workspaceId = activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");
    const found = await findMember(
      this.dataSource.manager,
      caller.user.id,
      workspaceId,
    );
    if (!found) throw organizationError(400, "MEMBER_NOT_FOUND");
    return memberWithUserOutput(found.member, found.user);
  }

  /** The caller's role, or another member's when `userId` is given. */
  async memberRole(
    caller: OrganizationCaller,
    selector: WorkspaceSelector,
    userId: string | undefined,
  ): Promise<{ role: string }> {
    const workspaceId = await this.memberWorkspace(caller, selector);
    const found = await findMember(
      this.dataSource.manager,
      userId ?? caller.user.id,
      workspaceId,
    );
    if (!found) {
      throw organizationError(403, "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION");
    }
    return { role: found.member.role };
  }

  /** The selected (or active) workspace, provided the caller belongs to it. */
  private async memberWorkspace(
    caller: OrganizationCaller,
    selector: WorkspaceSelector,
  ): Promise<string> {
    let workspaceId = selector.organizationId || activeOrganizationOf(caller);
    if (selector.organizationSlug) {
      const workspace = await findWorkspaceBySlug(
        this.dataSource.manager,
        selector.organizationSlug,
      );
      if (!workspace) throw organizationError(400, "ORGANIZATION_NOT_FOUND");
      workspaceId = workspace.id;
    }
    if (!workspaceId) throw organizationError(400, "NO_ACTIVE_ORGANIZATION");
    if (!(await findMember(this.dataSource.manager, caller.user.id, workspaceId))) {
      throw organizationError(403, "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION");
    }
    return workspaceId;
  }
}
