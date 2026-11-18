import { Inject, Module, type OnModuleInit } from "@nestjs/common";
import { DeferredIssueEditProviders } from "../git-shared/deferred-issue-edit-providers";
import { GitSharedModule } from "../git-shared/git-shared.module";
import { GitHubApp } from "./app/github-app";
import { GITHUB_DEPS, type GitHubDeps, gitHubDepsProvider } from "./github-deps";
import { GitHubIntegrationController } from "./github-integration.controller";
import { GitHubIntegrationService } from "./github-integration.service";
import { GitHubPlugin } from "./github.plugin";
import { GitHubImportService } from "./import/github-import.service";
import { GitHubImportLock } from "./import/github-import-lock";
import { githubDeferredEditAccess } from "./issues/github-deferred-edit-access";
import { GitHubWebhookController } from "./webhooks/github-webhook.controller";
import { GitHubWebhookReceiver } from "./webhooks/github-webhook-receiver";

/**
 * The GitHub App integration: `/api/github-integration` routes, the signed
 * webhook, the `github` plugin (two-way issue sync) and the issue import.
 */
@Module({
  imports: [GitSharedModule],
  controllers: [GitHubIntegrationController, GitHubWebhookController],
  providers: [
    GitHubApp,
    gitHubDepsProvider,
    GitHubPlugin,
    GitHubIntegrationService,
    GitHubImportService,
    GitHubImportLock,
    GitHubWebhookReceiver,
  ],
})
export class GitHubModule implements OnModuleInit {
  constructor(
    private readonly deferredEdits: DeferredIssueEditProviders,
    @Inject(GITHUB_DEPS) private readonly deps: GitHubDeps,
  ) {}

  onModuleInit(): void {
    this.deferredEdits.register("github", (integration, link) =>
      githubDeferredEditAccess(this.deps.github, integration, link),
    );
  }
}
