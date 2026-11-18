import { Module } from "@nestjs/common";
import { GitSharedModule } from "../git-shared/git-shared.module";
import { GiteaPlugin } from "./gitea.plugin";
import { GiteaImportService } from "./import/gitea-import.service";
import { GiteaIntegrationController } from "./integration/gitea-integration.controller";
import { GiteaIntegrationService } from "./integration/gitea-integration.service";
import { GiteaWebhookController } from "./webhook/gitea-webhook.controller";
import { GiteaWebhookService } from "./webhook/gitea-webhook.service";

/** The Gitea provider: its plugin, `/api/gitea-integration` routes and webhook. */
@Module({
  imports: [GitSharedModule],
  controllers: [GiteaIntegrationController, GiteaWebhookController],
  providers: [
    GiteaPlugin,
    GiteaIntegrationService,
    GiteaImportService,
    GiteaWebhookService,
  ],
})
export class GiteaModule {}
