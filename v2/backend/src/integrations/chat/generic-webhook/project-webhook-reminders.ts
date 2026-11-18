import { Injectable, Logger, type OnModuleInit, Optional } from "@nestjs/common";
import { DataSource } from "typeorm";
import { deleteReturning, insertReturning } from "../../../database/dml";
import { TaskReminderSentEntity } from "../../../database/entities/task-reminder-sent.entity";
import { JobScheduler } from "../../../scheduler/job-scheduler";
import {
  DUE_DATE_DURATION_MS,
  REMINDER_WINDOW_MINUTES,
} from "../../../scheduler/reminder-timing";
import {
  type GenericWebhookConfig,
  normalizeGenericWebhookConfig,
} from "./generic-webhook-config";
import { GenericWebhookDelivery } from "./generic-webhook-delivery";
import { sendDueDateReminder } from "./send-due-date-reminder";

const MINUTE_MS = 60 * 1000;

/**
 * Sends each opted-in project webhook a `task.due_date_reminder` once per
 * task, `dueDateReminderLeadTimeMinutes` before the due day ends. A failed
 * delivery releases its claim so the next run retries it.
 */
@Injectable()
export class ProjectWebhookReminders implements OnModuleInit {
  private readonly logger = new Logger(ProjectWebhookReminders.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly delivery: GenericWebhookDelivery,
    // Absent until the scheduler module is part of the application.
    @Optional() private readonly scheduler?: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler?.register({
      name: "project-webhook-reminders",
      cron: "*/5 * * * *",
      run: () => this.checkProjectWebhookReminders(),
    });
  }

  async checkProjectWebhookReminders(
    now = new Date(),
  ): Promise<{ degraded: boolean }> {
    const integrations = (await this.dataSource.query(
      `SELECT id, project_id AS "projectId", config
         FROM integration
        WHERE type = 'generic-webhook' AND is_active = true`,
    )) as { id: string; projectId: string; config: string }[];
    let degraded = false;

    for (const integration of integrations) {
      try {
        const config = normalizeGenericWebhookConfig(
          JSON.parse(integration.config) as GenericWebhookConfig,
        );
        if (!config.events?.dueDateReminder) continue;

        const leadTimeMinutes = config.dueDateReminderLeadTimeMinutes ?? 1440;
        // Count back from expiration while keeping the indexed due date unmodified.
        const windowEnd = new Date(
          now.getTime() + leadTimeMinutes * MINUTE_MS - DUE_DATE_DURATION_MS,
        );
        const windowStart = new Date(
          windowEnd.getTime() - REMINDER_WINDOW_MINUTES * MINUTE_MS,
        );
        const reminderType = `generic_webhook:${integration.id}`;
        const tasks = (await this.dataSource.query(
          `SELECT task.id, task.due_date AS "dueDate"
             FROM task
             LEFT JOIN "column" ON task.column_id = "column".id
             LEFT JOIN task_reminder_sent AS sent
               ON sent.task_id = task.id AND sent.reminder_type = $4
            WHERE task.project_id = $1
              AND task.due_date IS NOT NULL
              AND task.due_date BETWEEN $2 AND $3
              AND sent.id IS NULL
              AND ("column".is_final IS NULL OR "column".is_final = false)
              AND task.status <> 'archived'`,
          [integration.projectId, windowStart, windowEnd, reminderType],
        )) as { id: string; dueDate: Date | null }[];

        for (const task of tasks) {
          if (!task.dueDate) continue;

          const sent = await insertReturning(
            this.dataSource.manager,
            TaskReminderSentEntity,
            { taskId: task.id, reminderType },
            { onConflict: { target: ["taskId", "reminderType"] } },
          );
          if (!sent) continue;

          const delivered = await sendDueDateReminder(
            this.delivery,
            config,
            task.id,
            integration.projectId,
            leadTimeMinutes,
            task.dueDate,
          );

          if (!delivered) {
            await deleteReturning(
              this.dataSource.manager,
              TaskReminderSentEntity,
              { id: sent.id },
            );
          }
        }
      } catch {
        degraded = true;
        this.logger.error("Failed to process project webhook reminder", {
          integrationId: integration.id,
          projectId: integration.projectId,
        });
      }
    }

    return { degraded };
  }
}
