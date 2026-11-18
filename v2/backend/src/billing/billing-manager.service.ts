import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { WorkspaceMembershipService } from "../access/workspace-membership.service";
import { HTTPException } from "../common/errors/http-exception";
import { WorkspaceUserEntity } from "../database/entities/workspace-user.entity";

/** Checkout and the customer portal are for workspace owners and admins only. */
@Injectable()
export class BillingManagerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly membership: WorkspaceMembershipService,
  ) {}

  async requireBillingManager(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.membership.validateWorkspaceAccess(userId, workspaceId);

    const manager = await this.dataSource.manager.findOne(WorkspaceUserEntity, {
      where: { workspaceId, userId, role: In(["owner", "admin"]) },
    });
    if (!manager) {
      throw new HTTPException(403, {
        message: "Only workspace owners and admins can manage billing",
      });
    }
  }
}
