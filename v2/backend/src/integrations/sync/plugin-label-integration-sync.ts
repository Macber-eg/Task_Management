import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../../events/event-bus";
import { LabelIntegrationSync } from "../../label/label-integration-sync";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";
import { notifySyncWorkspaceLabelChanged } from "./workspace-label-changed";

/**
 * Routes label changes to the git provider plugins (`syncTaskLabel` /
 * `removeTaskLabel`); a provider that is not registered is skipped.
 */
@Injectable()
export class PluginLabelIntegrationSync extends LabelIntegrationSync {
  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {
    super();
  }

  private async sync(type: string, taskId: string, name: string, color: string) {
    await this.registry.get(type)?.syncTaskLabel?.(taskId, name, color);
  }

  private async remove(type: string, taskId: string, name: string) {
    await this.registry.get(type)?.removeTaskLabel?.(taskId, name);
  }

  syncLabelToGitHub(taskId: string, name: string, color: string) {
    return this.sync("github", taskId, name, color);
  }

  syncLabelToGitea(taskId: string, name: string, color: string) {
    return this.sync("gitea", taskId, name, color);
  }

  syncLabelToGitlab(taskId: string, name: string, color: string) {
    return this.sync("gitlab", taskId, name, color);
  }

  removeLabelFromGitHub(taskId: string, name: string) {
    return this.remove("github", taskId, name);
  }

  removeLabelFromGitea(taskId: string, name: string) {
    return this.remove("gitea", taskId, name);
  }

  removeLabelFromGitlab(taskId: string, name: string) {
    return this.remove("gitlab", taskId, name);
  }

  notifySyncWorkspaceLabelChanged(
    workspaceId: string,
    labelId: string,
    options?: { publishProjectUpdates?: boolean },
  ) {
    return notifySyncWorkspaceLabelChanged(
      this.dataSource.manager,
      this.events,
      workspaceId,
      labelId,
      options,
    );
  }
}
