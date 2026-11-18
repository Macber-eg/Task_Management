import { Injectable, Logger } from "@nestjs/common";
import type { IntegrationPlugin } from "./integration-plugin";

/**
 * The providers available in this process, keyed by `integration.type`.
 * Provider modules register in `onModuleInit`; everything else looks plugins
 * up at call time, so a provider registered later is picked up automatically.
 */
@Injectable()
export class IntegrationPluginRegistry {
  private readonly logger = new Logger(IntegrationPluginRegistry.name);
  private readonly plugins = new Map<string, IntegrationPlugin>();

  register(plugin: IntegrationPlugin): void {
    if (this.plugins.has(plugin.type)) {
      throw new Error(`Plugin ${plugin.type} already registered`);
    }
    this.plugins.set(plugin.type, plugin);
    this.logger.log(`Registered plugin: ${plugin.name}`);
  }

  get(type: string): IntegrationPlugin | undefined {
    return this.plugins.get(type);
  }

  list(): IntegrationPlugin[] {
    return [...this.plugins.values()];
  }
}
