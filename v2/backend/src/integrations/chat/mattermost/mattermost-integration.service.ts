import { Injectable } from "@nestjs/common";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import { WebhookChannelIntegrations } from "../shared/webhook-channel-integrations";
import {
  defaultMattermostEvents,
  normalizeMattermostConfig,
  type MattermostConfig,
  validateMattermostConfig,
} from "./mattermost-config";

@Injectable()
export class MattermostIntegrationService extends WebhookChannelIntegrations<MattermostConfig> {
  constructor(store: ProjectIntegrationStore) {
    super(store, {
      type: "mattermost",
      label: "Mattermost",
      defaultEvents: defaultMattermostEvents,
      normalize: normalizeMattermostConfig,
      validate: validateMattermostConfig,
      explicitWebhookUrl: true,
    });
  }
}
