import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../../events/event-bus";
import type { IntegrationPlugin } from "../core/integration-plugin";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";
import type { IssueAccess } from "../core/issue-access";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDescriptionChangedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
} from "../core/task-events";
import { DeferredIssueEditProviders } from "../git-shared/deferred-issue-edit-providers";
import { validateGiteaConfig } from "./config";
import { handleTaskCommentCreated } from "./events/task-comment-created";
import { handleTaskCreated } from "./events/task-created";
import { handleTaskDescriptionChanged } from "./events/task-description-changed";
import { handleTaskPriorityChanged } from "./events/task-priority-changed";
import { handleTaskStatusChanged } from "./events/task-status-changed";
import { handleTaskTitleChanged } from "./events/task-title-changed";
import { giteaDeferredEditAccess } from "./gitea-deferred-edit-access";
import { giteaIssueAccess } from "./gitea-issue-access";
import { removeLabelFromGitea, syncLabelToGitea } from "./labels/sync-label-to-gitea";

/** The Gitea provider: task events and label changes become issue writes. */
@Injectable()
export class GiteaPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "gitea";
  readonly name = "Gitea";

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly deferredEdits: DeferredIssueEditProviders,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.deferredEdits.register("gitea", giteaDeferredEditAccess);
  }

  private get db() {
    return this.dataSource.manager;
  }

  validateConfig(config: unknown) {
    return validateGiteaConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return handleTaskCreated(this.db, this.events, event, context);
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return handleTaskStatusChanged(this.db, this.events, event, context);
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskPriorityChanged(this.db, event, context);
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return handleTaskTitleChanged(this.db, this.events, event, context);
  }

  onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskDescriptionChanged(this.db, this.events, event, context);
  }

  onTaskCommentCreated(event: TaskCommentCreatedEvent, context: PluginContext) {
    return handleTaskCommentCreated(this.db, event, context);
  }

  syncTaskLabel(taskId: string, name: string, color: string) {
    return syncLabelToGitea(this.db, taskId, name, color);
  }

  removeTaskLabel(taskId: string, name: string) {
    return removeLabelFromGitea(this.db, taskId, name);
  }

  async issueAccess(
    integration: { type: string; config: string },
    link: { externalId: string; taskId: string },
  ): Promise<IssueAccess> {
    return giteaIssueAccess(integration.config, link);
  }
}
