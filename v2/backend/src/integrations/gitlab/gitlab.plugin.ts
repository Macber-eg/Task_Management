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
import { validateGitlabConfig } from "./config";
import { handleTaskCommentCreated } from "./events/task-comment-created";
import { handleTaskCreated } from "./events/task-created";
import { handleTaskDescriptionChanged } from "./events/task-description-changed";
import { handleTaskPriorityChanged } from "./events/task-priority-changed";
import { handleTaskStatusChanged } from "./events/task-status-changed";
import { handleTaskTitleChanged } from "./events/task-title-changed";
import { gitlabIssueAccess } from "./gitlab-issue-access";
import {
  removeLabelFromGitlab,
  syncLabelToGitlab,
} from "./labels/sync-label-to-gitlab";

/** The GitLab provider: task events and label changes become issue writes. */
@Injectable()
export class GitlabPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "gitlab";
  readonly name = "GitLab";

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  private get db() {
    return this.dataSource.manager;
  }

  validateConfig(config: unknown) {
    return validateGitlabConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return handleTaskCreated(this.db, this.events, event, context);
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return handleTaskStatusChanged(this.db, event, context);
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskPriorityChanged(this.db, event, context);
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return handleTaskTitleChanged(this.db, event, context);
  }

  onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskDescriptionChanged(this.db, event, context);
  }

  onTaskCommentCreated(event: TaskCommentCreatedEvent, context: PluginContext) {
    return handleTaskCommentCreated(this.db, event, context);
  }

  syncTaskLabel(taskId: string, name: string, color: string) {
    return syncLabelToGitlab(this.db, taskId, name, color);
  }

  removeTaskLabel(taskId: string, name: string) {
    return removeLabelFromGitlab(this.db, taskId, name);
  }

  async issueAccess(
    integration: { type: string; config: string },
    link: { externalId: string; taskId: string },
  ): Promise<IssueAccess> {
    return gitlabIssueAccess(integration.config, link);
  }
}
