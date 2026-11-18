// The shapes the notification email template renders (`@kaneo/email`).

export type BoardColumnIcon =
  | "circle"
  | "circle-dot"
  | "circle-dashed"
  | "search"
  | "check-circle"
  | "archive";

export type TaskCardPriority = "urgent" | "high" | "medium" | "low";

export type TaskCardDueStatus = "overdue" | "due-soon" | "far-future";

export type NotificationEmailTask = {
  ticket?: string;
  title: string;
  labels?: { name: string; color: string }[];
  priority?: TaskCardPriority;
  dueDate?: Date | string;
  dueStatus?: TaskCardDueStatus;
  assigneeInitials?: string;
  column?: {
    name: string;
    icon?: BoardColumnIcon;
    count?: number;
  };
};

export type NotificationEmail = {
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string;
  locale?: string | null;
  breadcrumb?: string;
  task?: NotificationEmailTask;
  settingsUrl?: string;
};
