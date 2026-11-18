import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { getMemberProjectAccess } from "../project-access/get-member-project-access";
import { isProjectAccessRestricted } from "../project-access/is-project-access-restricted";
import { listWorkspaceProjectAccess } from "../project-access/list-workspace-project-access";
import type { MemberProjectAccess } from "../project-access/member-project-access-type";

@Injectable()
export class MemberProjectAccessQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async getMyProjectAccess(
    workspaceId: string,
    userId: string,
  ): Promise<MemberProjectAccess> {
    const manager = this.dataSource.manager;
    if (!(await isProjectAccessRestricted(manager, workspaceId, userId))) {
      return { userId, projectAccess: "all", projectIds: [] };
    }
    return getMemberProjectAccess(manager, workspaceId, userId);
  }

  listWorkspaceProjectAccess(
    workspaceId: string,
    viewerId: string,
  ): Promise<MemberProjectAccess[]> {
    return listWorkspaceProjectAccess(
      this.dataSource.manager,
      workspaceId,
      viewerId,
    );
  }
}
