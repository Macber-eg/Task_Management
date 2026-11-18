import { Injectable } from "@nestjs/common";
import { ProjectIntegrationStore } from "../shared/project-integration-store";
import { WebhookChannelIntegrations } from "../shared/webhook-channel-integrations";
import {
  defaultSlackEvents,
  normalizeSlackConfig,
  type SlackConfig,
  validateSlackConfig,
} from "./slack-config";

@Injectable()
export class SlackIntegrationService extends WebhookChannelIntegrations<SlackConfig> {
  constructor(store: ProjectIntegrationStore) {
    super(store, {
      type: "slack",
      label: "Slack",
      defaultEvents: defaultSlackEvents,
      normalize: normalizeSlackConfig,
      validate: validateSlackConfig,
    });
  }
}
