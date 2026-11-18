import { Injectable } from "@nestjs/common";
import { TaskLabelIntegrationSync } from "../../task/seams/task-label-integration-sync";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";

/** Routes bulk label removals to the registered git provider plugins. */
@Injectable()
export class PluginTaskLabelIntegrationSync extends TaskLabelIntegrationSync {
  constructor(private readonly registry: IntegrationPluginRegistry) {
    super();
  }

  private async remove(type: string, taskId: string, name: string) {
    await this.registry.get(type)?.removeTaskLabel?.(taskId, name);
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
}
