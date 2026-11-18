import { Injectable } from "@nestjs/common";
import { formatBillableWorkspacesMessage } from "../../admin/account-deletion/format-billable-workspaces-message";
import { ApiError } from "../../common/errors/api-error";
import { WorkspaceDeletionGuard } from "../../organization/workspaces/workspace-deletion-guard";
import { BillableWorkspacesService } from "../billable-workspaces.service";

/** A workspace with a subscription that can still charge must be cancelled first. */
@Injectable()
export class BillingWorkspaceDeletionGuard extends WorkspaceDeletionGuard {
  constructor(private readonly billable: BillableWorkspacesService) {
    super();
  }

  async assertDeletable(workspace: { id: string; name: string }): Promise<void> {
    const billable = await this.billable.findBillableWorkspaces([workspace.id]);
    if (billable.length > 0) {
      throw new ApiError(409, {
        code: "WORKSPACE_HAS_ACTIVE_SUBSCRIPTION",
        message: formatBillableWorkspacesMessage(
          billable.map((row) => row.name),
        ),
      });
    }
  }
}
