/**
 * What project routes ask of billing: whether a workspace's plan still allows
 * creating and editing. Throws 402 when it does not. Provided by the global
 * billing module.
 */
export abstract class ProjectEntitlements {
  abstract requireWorkspaceEntitlement(workspaceId: string): Promise<void>;
}
