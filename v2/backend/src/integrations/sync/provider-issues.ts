import { Injectable } from "@nestjs/common";
import type { IssueAccess } from "../core/issue-access";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";

/**
 * Opens a linked issue through its provider plugin (`issueAccess`). Throws
 * when no registered plugin can, which the resume review reports as 502.
 */
@Injectable()
export class ProviderIssues {
  constructor(private readonly registry: IntegrationPluginRegistry) {}

  open(
    integration: { type: string; config: string },
    link: { externalId: string; taskId: string },
  ): Promise<IssueAccess> {
    const plugin = this.registry.get(integration.type);
    if (!plugin?.issueAccess)
      return Promise.reject(
        new Error(`No issue access for provider ${integration.type}`),
      );
    return plugin.issueAccess(integration, link);
  }
}
