import { Global, Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { StorageModule } from "../storage/storage.module";
import { DueDateReminders } from "./due-date-reminders.service";
import { JobScheduler } from "./job-scheduler";
import { JobLease } from "./leader-lock";
import { StorageCleanupJobs } from "./storage-cleanup-jobs";

/**
 * Recurring background work. Global so any feature module can inject
 * `JobScheduler` to register its jobs and `JobLease` to run them on one
 * replica only.
 */
@Global()
@Module({
  imports: [StorageModule, NotificationModule],
  providers: [JobScheduler, JobLease, StorageCleanupJobs, DueDateReminders],
  exports: [JobScheduler, JobLease],
})
export class SchedulerModule {}
