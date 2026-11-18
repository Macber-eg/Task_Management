import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ProjectAccessService } from "../access/project-access.service";
import { getMemberProjectAccess } from "./get-member-project-access";
import { isProjectAccessRestricted } from "./is-project-access-restricted";
import type { ResolvedProjectAccess } from "./project-access-request.service";

type Outcome =
  | { ok: true; access: ResolvedProjectAccess }
  | { ok: false; message: string };

@Injectable()
export class HiddenGrantsService {
  constructor(private readonly projectAccess: ProjectAccessService) {}

  /**
   * A restricted actor only edits the part of a member's selection they can
   * see: grants to projects hidden from the actor are carried over untouched.
   */
  async keepHiddenGrants(request: {
    workspaceId: string;
    actorId: string;
    userId: string;
    access: ResolvedProjectAccess;
    manager: EntityManager;
  }): Promise<Outcome> {
    const { workspaceId, actorId, userId, access, manager } = request;

    if (!(await isProjectAccessRestricted(manager, workspaceId, actorId))) {
      return { ok: true, access };
    }

    const current = await getMemberProjectAccess(manager, workspaceId, userId);
    if (current.projectAccess === "all") {
      return {
        ok: false,
        message:
          "You can't limit a member who can access every project while your own access is limited",
      };
    }

    const hidden = await this.projectAccess.findInaccessibleProjectIds(
      actorId,
      current.projectIds,
      manager,
    );
    return {
      ok: true,
      access: {
        projectAccess: access.projectAccess,
        projectIds: [...new Set([...access.projectIds, ...hidden])],
      },
    };
  }
}
