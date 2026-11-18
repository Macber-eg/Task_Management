/**
 * What deleting a workspace asks of billing: a workspace with an active
 * subscription must not be deleted until it is cancelled.
 */
export abstract class WorkspaceDeletionGuard {
  /** Throws (409 WORKSPACE_HAS_ACTIVE_SUBSCRIPTION) to refuse the deletion. */
  abstract assertDeletable(workspace: { id: string; name: string }): Promise<void>;
}
