import { Global, Module } from "@nestjs/common";
import { DeferredIssueEditProviders } from "./deferred-issue-edit-providers";
import { DeferredIssueEditsJob } from "./deferred-issue-edits.job";

/**
 * What the git provider modules share at runtime: the deferred issue edit
 * replay job and the registry of providers it replays through. Global so each
 * provider module can register with `DeferredIssueEditProviders`.
 */
@Global()
@Module({
  providers: [DeferredIssueEditProviders, DeferredIssueEditsJob],
  exports: [DeferredIssueEditProviders, DeferredIssueEditsJob],
})
export class GitSharedModule {}
