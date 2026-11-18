import { Injectable } from "@nestjs/common";
import { LabelIntegrationSync } from "./label-integration-sync";

/** Used until the integrations are ported: label changes stay local. */
@Injectable()
export class NoopLabelIntegrationSync extends LabelIntegrationSync {
  async syncLabelToGitHub(): Promise<void> {}

  async syncLabelToGitea(): Promise<void> {}

  async syncLabelToGitlab(): Promise<void> {}

  async removeLabelFromGitHub(): Promise<void> {}

  async removeLabelFromGitea(): Promise<void> {}

  async removeLabelFromGitlab(): Promise<void> {}

  async notifySyncWorkspaceLabelChanged(): Promise<void> {}
}
