import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { projectAccessCondition } from "../access/project-access-condition";
import { ProjectAccessService } from "../access/project-access.service";
import { HTTPException } from "../common/errors/http-exception";
import { findWorkspaceProjectIds } from "../project-access/find-workspace-project-ids";

export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

@Injectable()
export class WorkspaceMemberQueryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** Every member, or with `projectId` only those who can see that project. */
  async getWorkspaceMembers(request: {
    workspaceId: string;
    userId: string;
    projectId?: string;
  }): Promise<WorkspaceMember[]> {
    const { workspaceId, projectId } = request;
    const manager = this.dataSource.manager;

    if (projectId) {
      const [known] = await findWorkspaceProjectIds(manager, workspaceId, [
        projectId,
      ]);
      if (!known) {
        throw new HTTPException(404, { message: "Project not found" });
      }
      await this.projectAccess.assertProjectAccess(request.userId, projectId);
    }

    const select = `SELECT u.id, u.name, u.email, u.image, m.role
      FROM workspace_member m
      INNER JOIN "user" u ON m.user_id = u.id
      WHERE m.workspace_id = $1`;

    return (await (projectId
      ? manager.query(
          `${select} AND ${projectAccessCondition("m.user_id", "$2")}`,
          [workspaceId, projectId],
        )
      : manager.query(select, [workspaceId]))) as WorkspaceMember[];
  }
}
