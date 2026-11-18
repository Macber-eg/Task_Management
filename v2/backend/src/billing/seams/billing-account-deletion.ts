import { Injectable } from "@nestjs/common";
import { AccountDeletionBilling } from "../../admin/account-deletion/account-deletion-billing";
import { BillableWorkspacesService } from "../billable-workspaces.service";
import { SeatSyncService } from "../seat-sync.service";

@Injectable()
export class BillingAccountDeletion extends AccountDeletionBilling {
  constructor(
    private readonly billable: BillableWorkspacesService,
    private readonly seats: SeatSyncService,
  ) {
    super();
  }

  findBillableWorkspaces(workspaceIds: string[]) {
    return this.billable.findBillableWorkspaces(workspaceIds);
  }

  syncWorkspaceSeats(workspaceId: string) {
    return this.seats.syncWorkspaceSeats(workspaceId);
  }
}
