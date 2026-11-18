import { Module } from "@nestjs/common";
import { GitlabPlugin } from "./gitlab.plugin";
import { GitlabImportService } from "./import/gitlab-import.service";
import { GitlabIntegrationController } from "./integration/gitlab-integration.controller";
import { GitlabIntegrationService } from "./integration/gitlab-integration.service";
import { GitlabWebhookController } from "./webhook/gitlab-webhook.controller";
import { GitlabWebhookService } from "./webhook/gitlab-webhook.service";

/** The GitLab provider: its plugin, routes and webhook. */
@Module({
  controllers: [GitlabIntegrationController, GitlabWebhookController],
  providers: [
    GitlabPlugin,
    GitlabIntegrationService,
    GitlabImportService,
    GitlabWebhookService,
  ],
})
export class GitlabModule {}
