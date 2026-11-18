import { Global, Module } from "@nestjs/common";
import { LabelIntegrationSync } from "../../label/label-integration-sync";
import { TaskLabelIntegrationSync } from "../../task/seams/task-label-integration-sync";
import { PluginLabelIntegrationSync } from "./plugin-label-integration-sync";
import { PluginTaskLabelIntegrationSync } from "./plugin-task-label-integration-sync";
import { ProviderIssues } from "./provider-issues";
import { SyncEventSubscriber } from "./sync-event-subscriber";
import { SyncReconciler } from "./sync-reconciler";

/**
 * The shared git-provider sync engine. Global: it provides the label seams the
 * label and task modules inject, and the reconciler and issue access the git
 * provider modules use.
 */
@Global()
@Module({
  providers: [
    SyncReconciler,
    SyncEventSubscriber,
    ProviderIssues,
    { provide: LabelIntegrationSync, useClass: PluginLabelIntegrationSync },
    {
      provide: TaskLabelIntegrationSync,
      useClass: PluginTaskLabelIntegrationSync,
    },
  ],
  exports: [
    SyncReconciler,
    ProviderIssues,
    LabelIntegrationSync,
    TaskLabelIntegrationSync,
  ],
})
export class IntegrationSyncModule {}
