import type { EventBus } from "../../../events/event-bus";
import type { AfterCommit } from "../../links/integration-task-scope";
import type { UpdateTaskStatusResult } from "../../links/integration-tasks";

/** Queues `task.status_changed` after the commit when the update moved the task. */
export function publishStatusChange(
  events: EventBus,
  afterCommit: AfterCommit,
  result: UpdateTaskStatusResult,
): void {
  if (!result.applied || result.before.status === result.after.status) return;
  const { before, after } = result;
  afterCommit(() =>
    events.publish("task.status_changed", {
      taskId: after.id,
      projectId: after.projectId,
      userId: null,
      oldStatus: before.status,
      newStatus: after.status,
      title: after.title,
      assigneeId: after.userId,
      type: "status_changed",
    }),
  );
}
