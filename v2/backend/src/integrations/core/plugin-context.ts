import type { PluginContext } from "./task-events";

export function createPluginContext(integration: {
  id: string;
  projectId: string;
  config: string;
}): PluginContext {
  return {
    integrationId: integration.id,
    projectId: integration.projectId,
    config: JSON.parse(integration.config) as Record<string, unknown>,
  };
}
