/** The WebSocket message type a task, label, relation or comment event becomes. */
export function taskEventMessageType(eventName: string): string {
  switch (eventName) {
    case "task.created":
      return "TASK_CREATED";
    case "task.deleted":
      return "TASK_DELETED";
    case "task-relation.created":
    case "task-relation.deleted":
      return "TASK_RELATION_UPDATED";
    case "task.label_assigned":
    case "task.label_unassigned":
    case "task.label_created":
    case "task.labels_updated":
    case "task.label_deleted":
      return "TASK_LABEL_UPDATED";
    case "comment.created":
    case "comment.deleted":
    case "comment.updated":
      return "COMMENT_UPDATED";
    default:
      return "TASK_UPDATED";
  }
}
