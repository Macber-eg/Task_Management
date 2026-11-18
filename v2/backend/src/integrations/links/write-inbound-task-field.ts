import type { EntityManager } from "typeorm";
import type { EventBus } from "../../events/event-bus";
import type { IssueField } from "./deferred-issue-edit";
import type { AfterCommit } from "./integration-task-scope";
import { updateTaskStatus } from "./integration-tasks";
import { resolveTargetStatus } from "./resolve-target-status";

/**
 * Applies a provider's issue value to the task inside the caller's
 * integration transaction. A state change moves the task through the
 * provider's workflow rules (GitLab uses GitHub's, as before).
 */
export async function writeInboundTaskField(
  tx: EntityManager,
  events: EventBus,
  afterCommit: AfterCommit,
  link: { taskId: string },
  integration: { projectId: string; type: string },
  field: IssueField,
  value: string,
): Promise<void> {
  if (field === "state") {
    const status = await resolveTargetStatus(
      tx,
      integration.type === "gitea" ? "gitea" : "github",
      integration.projectId,
      value === "closed" ? "issue_closed" : "issue_reopened",
      value === "closed" ? "done" : "to-do",
    );
    const result = await updateTaskStatus(tx, link.taskId, status);
    if (result.applied && result.before.status !== result.after.status) {
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
  } else {
    await tx.query(
      `UPDATE task SET ${field === "title" ? "title" : "description"} = $1, updated_at = $2 WHERE id = $3 AND project_id = $4`,
      [value, new Date(), link.taskId, integration.projectId],
    );
  }
}
