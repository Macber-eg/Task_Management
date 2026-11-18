/** A job's own report of a run that finished but skipped or failed items. */
export type JobOutcome = { degraded?: boolean } | void;

export type ScheduledJob = {
  /** Unique among registered jobs; used in logs. */
  name: string;
  /** Croner pattern, evaluated in the server's time zone. */
  cron: string;
  run: () => Promise<JobOutcome>;
  /**
   * Skip a tick while the previous run is still going. Only guards this
   * process: use `JobLease` inside `run` to keep replicas from overlapping.
   */
  protect?: boolean;
};
