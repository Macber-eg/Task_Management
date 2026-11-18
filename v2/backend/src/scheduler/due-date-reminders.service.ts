import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../database/dml";
import { TaskReminderSentEntity } from "../database/entities/task-reminder-sent.entity";
import { NotificationCreationService } from "../notification/notification-creation.service";
import {
  buildDueDateReminderWindows,
  type DueDateReminderType,
  type DueDateReminderWindow,
} from "./due-date-reminder-windows";
import { JobScheduler } from "./job-scheduler";

type ReminderTask = {
  id: string;
  title: string;
  userId: string;
  dueDate: Date | null;
  projectId: string;
  leadTimeMinutes: number | null;
};

/**
 * Notifies assignees ahead of a due date (by their preferred lead time) and
 * once it has passed. `task_reminder_sent` makes each reminder fire once.
 */
@Injectable()
export class DueDateReminders implements OnModuleInit {
  private readonly logger = new Logger(DueDateReminders.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationCreationService,
    private readonly scheduler: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "due-date-reminders",
      cron: "*/5 * * * *",
      run: () => this.checkDueDateReminders(),
    });
  }

  async checkDueDateReminders(): Promise<{ degraded: boolean }> {
    let degraded = false;

    for (const window of buildDueDateReminderWindows(new Date())) {
      let tasks: ReminderTask[];
      try {
        tasks = await this.tasksNeedingReminder(window);
      } catch (error) {
        degraded = true;
        this.logger.error(
          `Failed to query tasks for due date reminders (${window.type})`,
          error,
        );
        continue;
      }

      for (const task of tasks) {
        try {
          await this.processReminder(task, window);
        } catch (error) {
          degraded = true;
          this.logger.error(
            `Failed to process due date reminder (task ${task.id}, ${window.type})`,
            error,
          );
        }
      }
    }

    return { degraded };
  }

  private tasksNeedingReminder({
    start,
    end,
    type,
  }: DueDateReminderWindow): Promise<ReminderTask[]> {
    const dueCondition =
      type === "configured_before"
        ? `task.due_date - (COALESCE(preference.due_date_reminder_lead_time_minutes, 1440) * interval '1 minute') BETWEEN $1 AND $2`
        : "task.due_date BETWEEN $1 AND $2";

    return this.dataSource.query(
      `SELECT task.id, task.title, task.assignee_id AS "userId",
              task.due_date AS "dueDate", task.project_id AS "projectId",
              preference.due_date_reminder_lead_time_minutes AS "leadTimeMinutes"
       FROM task
       INNER JOIN project ON project.id = task.project_id
       INNER JOIN workspace_member AS member
         ON member.workspace_id = project.workspace_id
        AND member.user_id = task.assignee_id
       LEFT JOIN "column" ON task.column_id = "column".id
       LEFT JOIN user_notification_preference AS preference
         ON preference.user_id = task.assignee_id
       LEFT JOIN task_reminder_sent AS sent
         ON sent.task_id = task.id AND sent.reminder_type = $3
       WHERE task.assignee_id IS NOT NULL
         AND task.due_date IS NOT NULL
         AND ${dueCondition}
         AND sent.id IS NULL
         AND (preference.id IS NULL OR preference.due_date_reminder_enabled = true)
         -- Final columns hold completed work; tasks without a column still count.
         AND ("column".is_final IS NULL OR "column".is_final = false)
         -- Archived tasks keep their due date but should not notify anyone.
         AND task.status <> 'archived'`,
      [start, end, type],
    ) as Promise<ReminderTask[]>;
  }

  private async processReminder(
    task: ReminderTask,
    { type, notificationType }: DueDateReminderWindow,
  ): Promise<void> {
    const notification = await this.dataSource.transaction(async (manager) => {
      const claimed = await insertReturning(
        manager,
        TaskReminderSentEntity,
        { taskId: task.id, reminderType: type satisfies DueDateReminderType },
        { onConflict: { target: ["taskId", "reminderType"] } },
      );
      if (!claimed) return null;

      const created = await this.notifications.persistNotification(
        {
          userId: task.userId,
          type: notificationType,
          eventData: {
            taskTitle: task.title,
            reminderType: type,
            leadTimeMinutes: task.leadTimeMinutes ?? 1440,
            dueDate: task.dueDate?.toISOString() ?? null,
          },
          resourceId: task.id,
          resourceType: "task",
        },
        manager,
      );
      if (!created) {
        await manager.delete(TaskReminderSentEntity, { id: claimed.id });
      }
      return created;
    });

    if (notification) await this.notifications.dispatchNotification(notification);
  }
}
