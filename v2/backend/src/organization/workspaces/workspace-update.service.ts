import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { updateReturning } from "../../database/dml";
import { WorkspaceEntity } from "../../database/entities/workspace.entity";
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
import { writtenWorkspaceOutput } from "../output/workspace-output";
import { OrganizationPermissionService } from "../roles/organization-permission.service";

export type WorkspaceChanges = {
  name?: string;
  slug?: string;
  logo?: string | null;
  metadata?: Record<string, unknown>;
  description?: string | null;
};

@Injectable()
export class WorkspaceUpdateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: OrganizationPermissionService,
  ) {}

  async update(
    caller: OrganizationCaller,
    organizationId: string | undefined,
    data: WorkspaceChanges,
  ) {
    const manager = this.dataSource.manager;
    const workspaceId = organizationId || activeOrganizationOf(caller);
    if (!workspaceId) throw organizationError(400, "ORGANIZATION_NOT_FOUND");

    const found = await findMember(manager, caller.user.id, workspaceId);
    if (!found) {
      throw organizationError(400, "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION");
    }
    const allowed = await this.permissions.hasPermission({
      workspaceId,
      role: found.member.role,
      permissions: { organization: ["update"] },
    });
    if (!allowed) {
      throw organizationError(
        403,
        "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION",
      );
    }

    if (typeof data.slug === "string") {
      const taken = await findWorkspaceBySlug(manager, data.slug);
      if (taken && taken.id !== workspaceId) {
        throw organizationError(400, "ORGANIZATION_SLUG_ALREADY_TAKEN");
      }
    }

    const changes: {
      name?: string;
      slug?: string;
      logo?: string | null;
      description?: string | null;
      metadata?: string;
    } = {};
    if (data.name !== undefined) changes.name = data.name;
    if (data.slug !== undefined) changes.slug = data.slug;
    if (data.logo !== undefined) changes.logo = data.logo;
    if (data.description !== undefined) changes.description = data.description;
    if (data.metadata !== undefined) {
      changes.metadata = JSON.stringify(data.metadata);
    }

    const [updated] =
      Object.keys(changes).length > 0
        ? await updateReturning(manager, WorkspaceEntity, changes, {
            id: workspaceId,
          })
        : [await findWorkspaceById(manager, workspaceId)];
    return updated ? writtenWorkspaceOutput(updated) : null;
  }
}
