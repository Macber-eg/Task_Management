/**
 * Kaneo Cloud billing: whether a workspace may still change tasks. The
 * billing feature should provide it; it throws to refuse (expired trial,
 * canceled subscription) and allows everything when billing is disabled.
 */
export abstract class TaskEntitlements {
  abstract requireWorkspaceEntitlement(workspaceId: string): Promise<void>;
}
