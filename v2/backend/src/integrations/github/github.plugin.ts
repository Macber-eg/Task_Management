import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { IssueAccess } from "../core/issue-access";
import type { IntegrationPlugin } from "../core/integration-plugin";
import { IntegrationPluginRegistry } from "../core/integration-plugin-registry";
import type {
  PluginContext,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDescriptionChangedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
} from "../core/task-events";
import { validateGitHubConfig } from "./config/github-config";
import { handleTaskCommentCreated } from "./events/task-comment-created";
import { handleTaskCreated } from "./events/task-created";
import { handleTaskDescriptionChanged } from "./events/task-description-changed";
import { handleTaskPriorityChanged } from "./events/task-priority-changed";
import { handleTaskStatusChanged } from "./events/task-status-changed";
import { handleTaskTitleChanged } from "./events/task-title-changed";
import { GITHUB_DEPS, type GitHubDeps } from "./github-deps";
import { githubIssueAccess } from "./issues/github-issue-access";
import {
  removeLabelFromGitHub,
  syncLabelToGitHub,
} from "./labels/github-label-sync";

/** The `github` integration type: two-way issue sync through the GitHub App. */
@Injectable()
export class GitHubPlugin implements IntegrationPlugin, OnModuleInit {
  readonly type = "github";
  readonly name = "GitHub";

  constructor(
    private readonly registry: IntegrationPluginRegistry,
    @Inject(GITHUB_DEPS) private readonly deps: GitHubDeps,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  validateConfig(config: unknown) {
    return validateGitHubConfig(config);
  }

  onTaskCreated(event: TaskCreatedEvent, context: PluginContext) {
    return handleTaskCreated(this.deps, event, context);
  }

  onTaskStatusChanged(event: TaskStatusChangedEvent, context: PluginContext) {
    return handleTaskStatusChanged(this.deps, event, context);
  }

  onTaskPriorityChanged(
    event: TaskPriorityChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskPriorityChanged(this.deps, event, context);
  }

  onTaskTitleChanged(event: TaskTitleChangedEvent, context: PluginContext) {
    return handleTaskTitleChanged(this.deps, event, context);
  }

  onTaskDescriptionChanged(
    event: TaskDescriptionChangedEvent,
    context: PluginContext,
  ) {
    return handleTaskDescriptionChanged(this.deps, event, context);
  }

  onTaskCommentCreated(event: TaskCommentCreatedEvent, context: PluginContext) {
    return handleTaskCommentCreated(this.deps, event, context);
  }

  syncTaskLabel(taskId: string, name: string, color: string) {
    return syncLabelToGitHub(this.deps, taskId, name, color);
  }

  removeTaskLabel(taskId: string, name: string) {
    return removeLabelFromGitHub(this.deps, taskId, name);
  }

  issueAccess(
    integration: { type: string; config: string },
    link: { externalId: string; taskId: string },
  ): Promise<IssueAccess> {
    return githubIssueAccess(this.deps.github, integration, link);
  }
}
