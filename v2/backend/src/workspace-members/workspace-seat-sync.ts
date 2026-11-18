/**
 * What membership changes ask of billing: the subscription's seat count
 * follows the number of members.
 */
export abstract class WorkspaceSeatSync {
  abstract syncWorkspaceSeats(workspaceId: string): Promise<void>;
}
