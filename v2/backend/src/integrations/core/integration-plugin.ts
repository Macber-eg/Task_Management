import type { IssueAccess } from "./issue-access";
import type {
  PluginContext,
  TaskAssigneeChangedEvent,
  TaskCommentCreatedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskEventHandler,
  TaskMovedEvent,
  TaskPriorityChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
  TaskUnassignedEvent,
} from "./task-events";

export type ExternalMetadata = {
  type: "issue" | "pull_request" | "branch";
  id: string;
  externalId: string;
  title: string | null;
  url: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type WebhookHandler = (
  payload: unknown,
  headers: Record<string, string>,
) => Promise<void>;

export type MetadataProvider = (
  taskId: string,
  context: PluginContext,
) => Promise<ExternalMetadata[]>;

export type ConfigValidator = (
  config: unknown,
) => Promise<{ valid: boolean; errors?: string[] }>;

/**
 * One integration provider. `type` is the `integration.type` value it serves;
 * the registry calls its task hooks for every active integration of that type
 * in the task's project (see `IntegrationEventDispatcher`). Hooks that throw
 * are logged and do not stop the other integrations.
 *
 * Register an instance in the provider module's `onModuleInit`:
 *
 *   constructor(private readonly registry: IntegrationPluginRegistry, …) {}
 *   onModuleInit() { this.registry.register(this.plugin); }
 */
export type IntegrationPlugin = {
  type: string;
  name: string;

  /**
   * Also called by sync reconciliation (`SyncReconciler`) to export a task
   * that newly matches a git provider's outgoing rule.
   */
  onTaskCreated?: TaskEventHandler<TaskCreatedEvent>;
  onTaskStatusChanged?: TaskEventHandler<TaskStatusChangedEvent>;
  onTaskPriorityChanged?: TaskEventHandler<TaskPriorityChangedEvent>;
  onTaskTitleChanged?: TaskEventHandler<TaskTitleChangedEvent>;
  onTaskDescriptionChanged?: TaskEventHandler<TaskDescriptionChangedEvent>;
  onTaskCommentCreated?: TaskEventHandler<TaskCommentCreatedEvent>;
  onTaskDeleted?: TaskEventHandler<TaskDeletedEvent>;
  onTaskMoved?: TaskEventHandler<TaskMovedEvent>;
  onTaskDueDateChanged?: TaskEventHandler<TaskDueDateChangedEvent>;
  onTaskAssigneeChanged?: TaskEventHandler<TaskAssigneeChangedEvent>;
  onTaskUnassigned?: TaskEventHandler<TaskUnassignedEvent>;

  /**
   * A label was created on or assigned to a task (the previous backend's
   * `syncLabelTo{GitHub,Gitea,Gitlab}`). Reached through `LabelIntegrationSync`.
   */
  syncTaskLabel?(taskId: string, name: string, color: string): Promise<void>;
  /**
   * A label was removed from a task (`removeLabelFrom{GitHub,Gitea,Gitlab}`).
   * Reached through `LabelIntegrationSync` and `TaskLabelIntegrationSync`.
   */
  removeTaskLabel?(taskId: string, name: string): Promise<void>;
  /**
   * Opens a linked issue for the sync resume review (`ProviderIssues`), the
   * previous backend's `providerIssue`. Git providers only.
   */
  issueAccess?(
    integration: { type: string; config: string },
    link: { externalId: string; taskId: string },
  ): Promise<IssueAccess>;

  handleWebhook?: WebhookHandler;
  getTaskMetadata?: MetadataProvider;
  validateConfig: ConfigValidator;
};
