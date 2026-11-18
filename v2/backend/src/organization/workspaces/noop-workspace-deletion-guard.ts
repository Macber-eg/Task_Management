import { Injectable } from "@nestjs/common";
import { WorkspaceDeletionGuard } from "./workspace-deletion-guard";

/** Used until billing is ported: no workspace has a subscription to protect. */
@Injectable()
export class NoopWorkspaceDeletionGuard extends WorkspaceDeletionGuard {
  async assertDeletable(): Promise<void> {}
}
