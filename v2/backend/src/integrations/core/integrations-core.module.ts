import { Global, Module } from "@nestjs/common";
import { IntegrationEventDispatcher } from "./integration-event-dispatcher";
import { IntegrationPluginRegistry } from "./integration-plugin-registry";
import { ScopeToProjectFromBodyHandler } from "./scope-to-project-from-body.handler";

/**
 * The plugin registry and the event dispatch to plugins. Global so every
 * provider module (chat channels now, git providers later) can register.
 */
@Global()
@Module({
  providers: [
    IntegrationPluginRegistry,
    IntegrationEventDispatcher,
    ScopeToProjectFromBodyHandler,
  ],
  exports: [IntegrationPluginRegistry, ScopeToProjectFromBodyHandler],
})
export class IntegrationsCoreModule {}
