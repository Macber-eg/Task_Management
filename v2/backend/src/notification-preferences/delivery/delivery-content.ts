export type DeliveryContent = {
  title: string;
  body: string;
};

function getStringValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function getNumberValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function formatLeadTime(minutes: number | null) {
  if (!minutes) return "soon";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${minutes} minutes`;
}

/** The title and text sent to push, webhook and email channels. */
export function buildDeliveryContent(notification: {
  type: string;
  content: string | null;
  title: string | null;
  eventData: Record<string, unknown> | null;
}): DeliveryContent {
  if (notification.title && notification.content) {
    return {
      title: notification.title,
      body: notification.content,
    };
  }

  switch (notification.type) {
    case "task_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "New task created",
        body: taskTitle
          ? `A new task was created: ${taskTitle}`
          : "A new task was created in Kaneo.",
      };
    }
    case "workspace_created": {
      const workspaceName = getStringValue(
        notification.eventData,
        "workspaceName",
      );
      return {
        title: "Workspace created",
        body: workspaceName
          ? `Workspace created: ${workspaceName}`
          : "A new workspace was created in Kaneo.",
      };
    }
    case "task_status_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const oldStatus = getStringValue(notification.eventData, "oldStatus");
      const newStatus = getStringValue(notification.eventData, "newStatus");
      return {
        title: "Task status changed",
        body:
          taskTitle && oldStatus && newStatus
            ? `${taskTitle} moved from ${oldStatus} to ${newStatus}.`
            : "A task status changed in Kaneo.",
      };
    }
    case "task_assignee_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task assigned to you",
        body: taskTitle
          ? `You were assigned to ${taskTitle}.`
          : "A task was assigned to you in Kaneo.",
      };
    }
    case "time_entry_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Time entry created",
        body: taskTitle
          ? `A time entry was created for ${taskTitle}.`
          : "A time entry was created in Kaneo.",
      };
    }
    case "due_date_reminder": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const label = formatLeadTime(
        getNumberValue(notification.eventData, "leadTimeMinutes"),
      );
      return {
        title: "Task due soon",
        body: taskTitle
          ? `"${taskTitle}" is due ${label}.`
          : `A task is due ${label}.`,
      };
    }
    case "task_overdue": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task overdue",
        body: taskTitle
          ? `"${taskTitle}" is past its due date.`
          : "A task is past its due date.",
      };
    }
    case "task_mention": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const mentionerName = getStringValue(
        notification.eventData,
        "mentionerName",
      );
      return {
        title: mentionerName
          ? `${mentionerName} mentioned you`
          : "You were mentioned",
        body: taskTitle
          ? `You were mentioned in ${taskTitle}.`
          : "You were mentioned in a Kaneo task.",
      };
    }
    case "task_comment": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const commenterName = getStringValue(
        notification.eventData,
        "commenterName",
      );
      return {
        title: commenterName
          ? `${commenterName} commented on your task`
          : "New task comment",
        body: taskTitle
          ? `A new comment was added to ${taskTitle}.`
          : "A new comment was added to a Kaneo task.",
      };
    }
    default:
      return {
        title: notification.title ?? "New Kaneo notification",
        body: notification.content ?? "You have a new notification in Kaneo.",
      };
  }
}
