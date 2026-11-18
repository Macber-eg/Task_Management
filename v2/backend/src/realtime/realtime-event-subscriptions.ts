import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../events/event-bus";
import { RealtimeAccessReader } from "./realtime-access-reader";
import { RealtimeHub } from "./realtime-hub";
import { taskEventMessageType } from "./task-event-message-type";

type TaskEvent = {
  titleChanged?: boolean;
  skipSubtaskParentRefresh?: boolean;
  projectId: string;
  initiatorId?: string;
  taskId: string;
  sourceTaskId: string | undefined;
  targetTaskId: string | undefined;
};

const TASK_UPDATE_EVENTS = [
  "task.created",
  "task.updated",
  "task.deleted",
  "task.status_changed",
  "task.priority_changed",
  "task.unassigned",
  "task.assignee_changed",
  "task.due_date_changed",
  "task.title_changed",
  "task.description_changed",
  "task.label_assigned",
  "task.label_unassigned",
  "task.label_created",
  "task.labels_updated",
  "task.label_deleted",
  "task-relation.created",
  "task-relation.deleted",
  "comment.created",
  "comment.deleted",
  "comment.updated",
];

/** Turns domain events into the WebSocket messages clients refresh on. */
@Injectable()
export class RealtimeEventSubscriptions implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly hub: RealtimeHub,
    private readonly reader: RealtimeAccessReader,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ projects: { projectId: string }[] }>(
      "subtask-parents.refresh",
      async ({ projects }) => {
        this.refreshParentBoards(projects);
      },
    );

    this.events.subscribe<{
      taskId: string;
      initiatorId?: string;
      fromProjectId: string;
      toProjectId: string;
    }>("task.moved", async ({ fromProjectId, initiatorId, toProjectId, taskId }) => {
      this.hub.broadcastToProject(
        toProjectId,
        { type: "TASK_MOVED", projectId: toProjectId, taskId },
        initiatorId,
      );
      this.hub.broadcastToProject(
        fromProjectId,
        { type: "TASK_MOVED", projectId: fromProjectId, taskId },
        initiatorId,
      );
      this.refreshParentBoards(
        await this.reader.subtaskParentProjects([taskId]),
        toProjectId,
      );
    });

    this.events.subscribe<{ projectId: string; initiatorId?: string }>(
      "task-relation.refresh",
      async ({ projectId, initiatorId }) => {
        if (!projectId) return;
        this.hub.broadcastToProject(
          projectId,
          {
            type: "TASK_RELATION_UPDATED",
            projectId,
            taskId: "",
            sourceTaskId: undefined,
            targetTaskId: undefined,
          },
          initiatorId,
        );
      },
    );

    // Project-scoped rather than per task: a project move can unassign every
    // task in the project at once, so clients refetch the board once instead
    // of receiving one message per task.
    this.events.subscribe<{ projectId: string; initiatorId?: string }>(
      "task.bulk_unassigned",
      async ({ projectId, initiatorId }) => {
        if (!projectId) return;
        this.hub.broadcastToProject(
          projectId,
          { type: "TASK_UPDATED", projectId, taskId: "" },
          initiatorId,
        );
      },
    );

    this.events.subscribe<{ userId: string }>(
      "notification.created",
      async ({ userId }) => {
        if (userId) this.hub.broadcastToUser(userId, { type: "NOTIFICATION_CREATED" });
      },
    );

    this.events.subscribe<{
      workspaceId: string;
      userId: string;
      projectIds?: string[];
    }>("project_access.updated", async ({ workspaceId, userId, projectIds }) => {
      if (!workspaceId || !userId) return;
      await this.hub.projectAccessChanged(userId, workspaceId);
      await this.broadcastProjectMembersUpdated(workspaceId, projectIds);
    });

    this.events.subscribe<{ workspaceId: string; projectIds?: string[] }>(
      "project_members.updated",
      async ({ workspaceId, projectIds }) => {
        if (!workspaceId) return;
        await this.broadcastProjectMembersUpdated(workspaceId, projectIds);
      },
    );

    this.events.subscribe<{
      projectId: string;
      initiatorId?: string;
      linksChanged?: boolean;
    }>("project.updated", async ({ projectId, initiatorId, linksChanged }) => {
      if (!projectId) return;
      this.hub.broadcastToProject(
        projectId,
        {
          type: "PROJECT_UPDATED",
          projectId,
          ...(linksChanged ? { linksChanged: true } : {}),
        },
        initiatorId,
      );
    });

    for (const eventName of TASK_UPDATE_EVENTS) {
      this.events.subscribe<TaskEvent>(eventName, (data) =>
        this.onTaskEvent(eventName, data),
      );
    }

    this.events.subscribe<{
      projectId: string;
      tasks: Array<{ id: string; position: number; status?: string }>;
    }>("tasks.reordered", async ({ projectId, tasks }) => {
      this.hub.broadcastToProject(projectId, {
        type: "TASKS_REORDERED",
        projectId,
        tasks,
      });
    });
  }

  private async onTaskEvent(eventName: string, data: TaskEvent) {
    const { projectId, initiatorId, taskId } = data;
    if (!projectId || !taskId) return;
    const type = taskEventMessageType(eventName);

    if (eventName === "task.label_deleted") {
      // Cascade deletion waits for this adapter operation rather than growing
      // the ordinary 100ms broadcast queue behind a slow Redis connection.
      await this.hub.publishToProject(
        projectId,
        { type, projectId, taskId },
        initiatorId,
      );
      return;
    }

    this.hub.broadcastToProject(
      projectId,
      {
        type,
        projectId,
        taskId,
        sourceTaskId: data.sourceTaskId,
        targetTaskId: data.targetTaskId,
        ...(eventName === "task.title_changed" || data.titleChanged
          ? { taskTitleChanged: true }
          : {}),
      },
      initiatorId,
    );
    if (eventName === "task.status_changed" && !data.skipSubtaskParentRefresh) {
      this.refreshParentBoards(
        await this.reader.subtaskParentProjects([taskId]),
        projectId,
      );
    } else if (eventName === "task-relation.deleted" && data.sourceTaskId) {
      this.refreshParentBoards(
        await this.reader.relationSourceProjects(data.sourceTaskId),
        projectId,
      );
    }
  }

  // Includes the initiating window: its local mutation refreshes the child
  // project, while it may be displaying a different parent board. Never
  // sends child data.
  private refreshParentBoards(
    projects: { projectId: string }[],
    currentProjectId = "",
  ) {
    for (const { projectId } of projects) {
      if (projectId === currentProjectId) continue;
      this.hub.broadcastToProject(projectId, {
        type: "TASK_RELATION_UPDATED",
        projectId,
        taskId: "",
      });
    }
  }

  private async broadcastProjectMembersUpdated(
    workspaceId: string,
    projectIds?: string[],
  ) {
    for (const projectId of projectIds ??
      (await this.reader.workspaceProjectIds(workspaceId)))
      this.hub.broadcastToProject(projectId, {
        type: "PROJECT_MEMBERS_UPDATED",
        projectId,
      });
  }
}
