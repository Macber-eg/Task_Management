import type { IntegrationPlugin } from "../../../src/integrations/core/integration-plugin";
import { IntegrationPluginRegistry } from "../../../src/integrations/core/integration-plugin-registry";

/**
 * A registry pre-loaded with test plugins. A provider module registering a
 * real plugin of the same type later is ignored, so tests keep their fakes
 * once the git providers exist.
 */
export class PluginRegistryDouble extends IntegrationPluginRegistry {
  private readonly pinned: Set<string>;

  constructor(fakes: IntegrationPlugin[]) {
    super();
    this.pinned = new Set(fakes.map((fake) => fake.type));
    for (const fake of fakes) super.register(fake);
  }

  override register(plugin: IntegrationPlugin): void {
    if (this.pinned.has(plugin.type)) return;
    super.register(plugin);
  }
}
