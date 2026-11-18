import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { SessionService } from "../../auth/sessions/session.service";
import { findMember } from "../lookups/find-member";
import {
  findWorkspaceById,
  findWorkspaceBySlug,
} from "../lookups/find-workspace";
import {
  activeOrganizationOf,
  type OrganizationCaller,
} from "../organization-caller.service";
import { organizationError } from "../organization-error";
import { workspaceOutput } from "../output/workspace-output";

/**
 * The workspace a login session is working in, stored on its `session` row.
 * An API key has no session row, so for it nothing is stored.
 */
@Injectable()
export class ActiveOrganizationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
  ) {}

  /** `organizationId: null` clears it; neither id nor slug re-checks the current one. */
  async setActive(
    caller: OrganizationCaller,
    target: { organizationId?: string | null; organizationSlug?: string },
  ) {
    const manager = this.dataSource.manager;
    const current = activeOrganizationOf(caller);
    let workspaceId = target.organizationId;

    if (workspaceId === null) {
      if (current) await this.store(caller, null);
      return null;
    }
    if (!workspaceId && !target.organizationSlug) {
      if (!current) return null;
      workspaceId = current;
    }
    if (target.organizationSlug && !workspaceId) {
      const bySlug = await findWorkspaceBySlug(manager, target.organizationSlug);
      if (!bySlug) throw organizationError(400, "ORGANIZATION_NOT_FOUND");
      workspaceId = bySlug.id;
    }
    if (!workspaceId) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    if (!(await findMember(manager, caller.user.id, workspaceId))) {
      await this.store(caller, null);
      throw organizationError(403, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION");
    }
    const workspace = await findWorkspaceById(manager, workspaceId);
    if (!workspace) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    await this.store(caller, workspace.id);
    return workspaceOutput(workspace);
  }

  private async store(caller: OrganizationCaller, workspaceId: string | null) {
    if (caller.session) {
      await this.sessions.setActiveOrganization(caller.session.id, workspaceId);
    }
  }
}
