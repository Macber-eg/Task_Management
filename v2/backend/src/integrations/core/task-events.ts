/** What a plugin hook receives besides the event: the integration row it runs for. */
export type PluginContext = {
  integrationId: string;
  projectId: string;
  /** The parsed `integration.config` JSON, exactly as stored. */
  config: Record<string, unknown>;
};

export type TaskCreatedEvent = {
  taskId: string;
  projectId: string;
  userId: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  number: number;
};

export type TaskStatusChangedEvent = {
  /** Set when the change came from this integration; it is not echoed back. */
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldStatus: string;
  newStatus: string;
  title: string;
};

export type TaskPriorityChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldPriority: string;
  newPriority: string;
  title: string;
};

export type TaskTitleChangedEvent = {
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldTitle: string;
  newTitle: string;
};

export type TaskDescriptionChangedEvent = {
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldDescription: string | null;
  newDescription: string | null;
};

export type TaskCommentCreatedEvent = {
  taskId: string;
  projectId: string;
  userId: string;
  comment: string;
};

export type TaskDeletedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
};

/** `projectId` is the destination project. */
export type TaskMovedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
};

export type TaskDueDateChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  oldDueDate: Date | null;
  newDueDate: Date | null;
};

export type TaskAssigneeChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  oldAssignee: string | null;
  newAssignee: string | undefined;
  newAssigneeId: string;
};

export type TaskUnassignedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
};

export type TaskEvent =
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskPriorityChangedEvent
  | TaskTitleChangedEvent
  | TaskDescriptionChangedEvent
  | TaskCommentCreatedEvent
  | TaskDeletedEvent
  | TaskMovedEvent
  | TaskDueDateChangedEvent
  | TaskAssigneeChangedEvent
  | TaskUnassignedEvent;

export type TaskEventHandler<T extends TaskEvent = TaskEvent> = (
  event: T,
  context: PluginContext,
) => Promise<void>;
