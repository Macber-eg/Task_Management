import { Injectable, Logger } from "@nestjs/common";
import { DataSource, LessThan } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";

const MIN_INTERVAL_MS = 10_000;

/**
 * Expired keys are deleted, not kept: the key endpoints trigger this sweep
 * as the previous backend's did, at most once every ten seconds per process.
 */
@Injectable()
export class ExpiredApiKeyCleanup {
  private readonly logger = new Logger(ExpiredApiKeyCleanup.name);
  private lastRunAt = 0;

  constructor(private readonly dataSource: DataSource) {}

  /** Never rejects: callers start it and answer without waiting. */
  async run(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRunAt < MIN_INTERVAL_MS) return;
    this.lastRunAt = now;

    try {
      await this.dataSource.manager.delete(ApikeyEntity, {
        expiresAt: LessThan(new Date(now)),
      });
    } catch (error) {
      this.logger.error("Failed to delete expired API keys", error);
    }
  }
}
