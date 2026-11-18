import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { EventBus } from "../../events/event-bus";
import { JobScheduler } from "../../scheduler/job-scheduler";
import { JobLease } from "../../scheduler/leader-lock";
import { PendingEcho } from "../links/inbound-echo";
import { DeferredIssueEditProviders } from "./deferred-issue-edit-providers";
import { replayDeferredIssueEdit } from "./replay-deferred-issue-edit";

const BATCH_SIZE = 20;
const RUN_BUDGET_MS = 45_000;

/**
 * The `deferred-issue-edits` job: every minute, on one replica, replays up to
 * a batch of issue links whose webhook delivery or outbound repair was
 * deferred (`deferredIssueEdit` in the link metadata), resuming after the
 * last link it saw.
 */
@Injectable()
export class DeferredIssueEditsJob implements OnModuleInit {
  private readonly logger = new Logger(DeferredIssueEditsJob.name);
  private running = false;
  private cursor: string | undefined;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly scheduler: JobScheduler,
    private readonly lease: JobLease,
    private readonly providers: DeferredIssueEditProviders,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: "deferred-issue-edits",
      cron: "* * * * *",
      run: () => this.replayDeferredIssueEdits(),
    });
  }

  replayDeferredIssueEdits(): Promise<{ degraded?: boolean }> {
    return this.lease.withJobLease(
      "deferred-issue-edits",
      () => this.replayClaimedIssueEdits(),
      () => ({}),
    );
  }

  private async replayClaimedIssueEdits(): Promise<{ degraded?: boolean }> {
    if (this.running) return {};
    this.running = true;
    let degraded = false;
    const deadline = Date.now() + RUN_BUDGET_MS;
    const db = this.dataSource.manager;
    try {
      const query = db
        .createQueryBuilder(ExternalLinkEntity, "link")
        .leftJoinAndSelect("link.integration", "integration")
        .where(
          `link.resource_type = 'issue' AND link.metadata LIKE '%"deferredIssueEdit":%'`,
        )
        .orderBy("link.id", "ASC")
        .limit(BATCH_SIZE);
      if (this.cursor) query.andWhere("link.id > :cursor", { cursor: this.cursor });
      const links = await query.getMany();
      if (!links.length) this.cursor = undefined;
      let processed = 0;
      for (const link of links) {
        if (Date.now() >= deadline) break;
        this.cursor = link.id;
        processed++;
        try {
          await replayDeferredIssueEdit(
            db,
            this.events,
            this.providers,
            link,
          );
        } catch (error) {
          if (error instanceof PendingEcho) continue;
          degraded = true;
          this.logger.error(
            `Deferred issue edit failed (external link ${link.id})`,
          );
        }
      }
      if (processed === links.length && links.length < BATCH_SIZE)
        this.cursor = undefined;
      return { degraded };
    } finally {
      this.running = false;
    }
  }
}
