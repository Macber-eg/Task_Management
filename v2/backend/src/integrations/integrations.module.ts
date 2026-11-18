import { Module } from "@nestjs/common";
import { ChatIntegrationsModule } from "./chat/chat-integrations.module";
import { IntegrationsCoreModule } from "./core/integrations-core.module";
import { GiteaModule } from "./gitea/gitea.module";
import { GitlabModule } from "./gitlab/gitlab.module";
import { GitHubModule } from "./github/github.module";
import { IntegrationSyncModule } from "./sync/integration-sync.module";
import { IntegrationSyncRoutesModule } from "./sync-routes/integration-sync-routes.module";

/**
 * Integrations: the plugin framework (`core/`), the shared git-provider sync
 * engine (`sync/`, `links/`), its routes (`sync-routes/`) and the outbound
 * chat and webhook channels (`chat/`). Git providers add their own modules.
 */
@Module({
  imports: [
    IntegrationsCoreModule,
    IntegrationSyncModule,
    IntegrationSyncRoutesModule,
    ChatIntegrationsModule,
    GiteaModule,
    GitlabModule,
    GitHubModule,
  ],
})
export class IntegrationsModule {}
