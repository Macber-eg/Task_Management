import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { BillingReminderSentEntity } from "../../database/entities/billing-reminder-sent.entity";
import { EmailService } from "../../email/email.service";
import { isSmtpConfigured } from "../../email/smtp-config";
import { JobScheduler } from "../../scheduler/job-scheduler";
import { isBillingEnabled, trialDays } from "../billing-config";

const DAY_MS = 24 * 60 * 60 * 1000;

// Sending is deliberately slow. The provider rate-limits per second and per
// day, and a burst that trips either is silently dropped downstream: SMTP has
// already accepted the message, so nothing surfaces as an error here.
const DEFAULT_MAX_PER_RUN = 25;
const SEND_SPACING_MS = 600;

type ReminderType = "trial_ending" | "trial_expired";

const REMINDERS: {
  type: ReminderType;
  subject: (workspaceName: string) => string;
}[] = [
  {
    type: "trial_ending",
    subject: (name) => `Your ${name} trial ends in 3 days`,
  },
  {
    type: "trial_expired",
    subject: (name) => `Your ${name} trial has ended`,
  },
];

type ReminderRow = {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  trialEndsAt: Date | null;
  email: string | null;
};

function maxPerRun() {
  const parsed = Number.parseInt(
    process.env.BILLING_REMINDER_MAX_PER_RUN ?? "",
    10,
  );
  return Number.isNaN(parsed) || parsed <= 0 ? DEFAULT_MAX_PER_RUN : parsed;
}

function clientUrl() {
  return (process.env.KANEO_CLIENT_URL ?? "https://cloud.kaneo.app").replace(
    /\/$/,
    "",
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Emails trial owners three days before the trial ends, and once it has. */
@Injectable()
export class TrialReminders implements OnModuleInit {
  private readonly logger = new Logger(TrialReminders.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly scheduler: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "trial-reminders",
      cron: "23 * * * *",
      run: () => this.checkTrialReminders(),
    });
  }

  async checkTrialReminders(): Promise<{ degraded: boolean }> {
    if (!isBillingEnabled() || !isSmtpConfigured()) {
      return { degraded: false };
    }

    const now = new Date();
    const limit = maxPerRun();
    let sent = 0;
    let degraded = false;

    for (const reminder of REMINDERS) {
      if (sent >= limit) break;
      let rows: ReminderRow[];
      try {
        rows = await this.ownersNeedingReminder(reminder.type, now, limit - sent);
      } catch (error) {
        this.logger.error(`Failed to query ${reminder.type} reminders`, error);
        degraded = true;
        continue;
      }

      for (const row of rows) {
        if (!row.email || !row.trialEndsAt) {
          continue;
        }

        // Claim the send first: a duplicate email is worse than a missed one,
        // and the unique constraint makes a concurrent run a no-op.
        const claimed = await insertReturning(
          this.dataSource.manager,
          BillingReminderSentEntity,
          {
            userId: row.userId,
            workspaceId: row.workspaceId,
            reminderType: reminder.type,
            trialEndsAt: row.trialEndsAt,
          },
          { onConflict: { target: ["userId", "reminderType"] } },
        );
        if (!claimed) {
          continue;
        }

        const daysLeft = Math.max(
          0,
          Math.ceil((row.trialEndsAt.getTime() - now.getTime()) / DAY_MS),
        );

        if (sent > 0) {
          await sleep(SEND_SPACING_MS);
        }

        await this.email.sendTrialReminderEmail(
          row.email,
          reminder.subject(row.workspaceName),
          {
            workspaceName: row.workspaceName,
            daysLeft,
            billingUrl: `${clientUrl()}/dashboard/settings/workspace/billing`,
            trialDays: trialDays(),
            endsAt: row.trialEndsAt,
          },
        );
        sent++;
      }
    }

    if (sent > 0) {
      this.logger.log(`Sent ${sent} trial reminder email(s)`);
    }

    return { degraded };
  }

  // One row per owner, not per workspace: trials are granted per owner, so a
  // person with twenty workspaces must still get one email, not twenty.
  // DISTINCT ON forces ORDER BY to lead with the owner, so urgency ordering
  // has to happen outside it or the cap would drop the soonest expiries.
  private ownersNeedingReminder(
    type: ReminderType,
    now: Date,
    limit: number,
  ): Promise<ReminderRow[]> {
    const windowEnd =
      type === "trial_ending" ? new Date(now.getTime() + 3 * DAY_MS) : now;
    const trialWindow =
      type === "trial_ending"
        ? "billing.trial_ends_at > $3 AND billing.trial_ends_at <= $2"
        : "billing.trial_ends_at <= $2";
    const parameters: unknown[] = [type, windowEnd];
    if (type === "trial_ending") {
      parameters.push(new Date(now.getTime() + 2 * DAY_MS));
    }
    parameters.push(limit);
    const limitParameter = `$${parameters.length}`;

    return this.dataSource.query(
      `SELECT owners.* FROM (
         SELECT DISTINCT ON (member.user_id)
           member.user_id AS "userId",
           workspace.id AS "workspaceId",
           workspace.name AS "workspaceName",
           billing.trial_ends_at AS "trialEndsAt",
           "user".email
         FROM workspace_billing AS billing
         INNER JOIN workspace ON workspace.id = billing.workspace_id
         INNER JOIN workspace_member AS member
           ON member.workspace_id = billing.workspace_id
          AND member.role = 'owner'
         INNER JOIN "user" ON "user".id = member.user_id
         LEFT JOIN billing_reminder_sent AS sent
           ON sent.user_id = member.user_id AND sent.reminder_type = $1
         WHERE sent.id IS NULL
           AND billing.founding_free = false
           AND billing.trial_ends_at IS NOT NULL
           AND billing.creem_subscription_id IS NULL
           AND ${trialWindow}
           AND "user".banned = false
         ORDER BY member.user_id ASC, billing.trial_ends_at ASC
       ) AS owners
       ORDER BY owners."trialEndsAt" ASC
       LIMIT ${limitParameter}`,
      parameters,
    ) as Promise<ReminderRow[]>;
  }
}
