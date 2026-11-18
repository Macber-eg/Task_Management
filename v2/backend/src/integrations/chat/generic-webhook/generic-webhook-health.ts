import { Injectable, Logger } from "@nestjs/common";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import {
  type GenericWebhookConfig,
  normalizeGenericWebhookConfig,
} from "./generic-webhook-config";

/** Records the last delivery outcome in the project's webhook config. */
@Injectable()
export class GenericWebhookHealth {
  private readonly logger = new Logger(GenericWebhookHealth.name);

  constructor(private readonly store: ProjectIntegrationStore) {}

  async persist(
    projectId: string,
    update: (config: GenericWebhookConfig) => GenericWebhookConfig,
  ): Promise<void> {
    try {
      const integration = await this.store.find(projectId, "generic-webhook");
      if (!integration) {
        return;
      }

      const currentConfig = normalizeGenericWebhookConfig(
        JSON.parse(integration.config) as GenericWebhookConfig,
      );
      await this.store.update(integration.id, {
        config: update(currentConfig),
      });
    } catch {
      this.logger.error("persistWebhookHealth failed", {
        error: "Webhook health update failed",
        projectId,
      });
    }
  }
}
