import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Cron } from "croner";
import type { ScheduledJob } from "./scheduled-job";

/**
 * Runs the API's recurring background work on cron schedules. Jobs are
 * registered while modules initialize and start once the application has
 * bootstrapped. Under `NODE_ENV=test` nothing starts on its own, so
 * integration tests never race scheduled work; a test that wants the
 * schedules calls `start()`.
 */
@Injectable()
export class JobScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(JobScheduler.name);
  private readonly registered: ScheduledJob[] = [];
  private readonly running: Cron[] = [];

  /**
   * Adds a job. Call it from a provider's `onModuleInit`, e.g.
   *
   *   onModuleInit() {
   *     this.scheduler.register({
   *       name: "deferred-issue-edits",
   *       cron: "* * * * *",
   *       run: () => this.replayDeferredIssueEdits(),
   *     });
   *   }
   *
   * `run` may return `{ degraded: true }` for a run that handled its own
   * per-item failures; a throw is logged and never stops the schedule. Wrap
   * the body in `JobLease.withJobLease` when only one replica may run it.
   */
  register(job: ScheduledJob): void {
    if (this.registered.some((existing) => existing.name === job.name)) {
      throw new Error(`Scheduled job "${job.name}" is already registered`);
    }
    this.registered.push(job);
    if (this.running.length > 0) this.schedule(job);
  }

  /** Every registered job, started or not. */
  jobs(): readonly ScheduledJob[] {
    return this.registered;
  }

  isRunning(): boolean {
    return this.running.length > 0;
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;
    this.start();
  }

  beforeApplicationShutdown(): void {
    this.stop();
  }

  start(): void {
    if (this.running.length > 0) return;
    for (const job of this.registered) this.schedule(job);
    if (this.registered.length > 0) {
      this.logger.log(
        `Scheduler started: ${this.registered.map((job) => job.name).join(", ")}`,
      );
    }
  }

  stop(): void {
    for (const cron of this.running) cron.stop();
    this.running.length = 0;
  }

  /** One run of a job outside its schedule, with the scheduler's error handling. */
  async runNow(name: string): Promise<void> {
    const job = this.registered.find((candidate) => candidate.name === name);
    if (!job) throw new Error(`No scheduled job named "${name}"`);
    await this.execute(job);
  }

  private schedule(job: ScheduledJob): void {
    this.running.push(
      new Cron(job.cron, { protect: job.protect ?? false }, () =>
        this.execute(job),
      ),
    );
  }

  // Jobs swallow per-item failures to finish the batch and report them as
  // `degraded`; an unexpected throw is logged here so one bad tick cannot
  // surface as an unhandled rejection.
  private async execute(job: ScheduledJob): Promise<void> {
    try {
      const outcome = await job.run();
      if (outcome && outcome.degraded) {
        this.logger.warn(`Cron job ${job.name} finished degraded`);
      }
    } catch (error) {
      this.logger.error(`Cron job ${job.name} failed`, error);
    }
  }
}
