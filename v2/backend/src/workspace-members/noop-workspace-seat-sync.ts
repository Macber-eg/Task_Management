import { Injectable } from "@nestjs/common";
import { WorkspaceSeatSync } from "./workspace-seat-sync";

/** Used until billing is ported: seat counts are not reported anywhere. */
@Injectable()
export class NoopWorkspaceSeatSync extends WorkspaceSeatSync {
  async syncWorkspaceSeats(): Promise<void> {}
}
