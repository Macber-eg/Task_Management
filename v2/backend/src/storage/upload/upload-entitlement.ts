/**
 * Kaneo Cloud billing: whether a workspace may still create and edit. The
 * previous API answered 402 when the plan had expired and did nothing when
 * billing was disabled.
 */
export abstract class UploadEntitlement {
  abstract requireWorkspaceEntitlement(workspaceId: string): Promise<void>;
}
