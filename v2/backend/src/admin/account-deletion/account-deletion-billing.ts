/**
 * What deleting an account asks of billing (a later phase). A workspace with
 * an active subscription must not be deleted with its last member, and a
 * workspace the account leaves needs its seats re-counted.
 */
export abstract class AccountDeletionBilling {
  /** The given workspaces that still have an active subscription. */
  abstract findBillableWorkspaces(
    workspaceIds: string[],
  ): Promise<{ workspaceId: string; name: string }[]>;

  abstract syncWorkspaceSeats(workspaceId: string): Promise<void>;
}
