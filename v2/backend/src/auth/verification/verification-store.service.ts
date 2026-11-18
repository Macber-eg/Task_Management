import { Injectable } from "@nestjs/common";
import { DataSource, LessThan } from "typeorm";
import { insertReturning } from "../../database/dml";
import { VerificationEntity } from "../../database/entities/verification.entity";

/**
 * Short-lived secrets in the `verification` table: password-reset tokens,
 * sign-in codes and magic links. `identifier` is not unique; the newest row
 * for an identifier is the current one, as with the previous backend.
 */
@Injectable()
export class VerificationStore {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    identifier: string,
    value: string,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    await insertReturning(this.dataSource.manager, VerificationEntity, {
      identifier,
      value,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** The newest row, expired or not. Looking up also purges expired rows. */
  async findLatest(identifier: string): Promise<VerificationEntity | null> {
    const manager = this.dataSource.manager;
    const [latest] = await manager.find(VerificationEntity, {
      where: { identifier },
      order: { createdAt: "DESC" },
      take: 1,
    });
    await manager.delete(VerificationEntity, { expiresAt: LessThan(new Date()) });
    return latest ?? null;
  }

  async deleteByIdentifier(identifier: string): Promise<void> {
    await this.dataSource.manager.delete(VerificationEntity, { identifier });
  }

  /**
   * Removes every row of the identifier and returns the newest, unless it
   * has expired. Of concurrent callers only the first gets the row, so a
   * secret can be redeemed once.
   */
  async consume(identifier: string): Promise<VerificationEntity | null> {
    const [latest] = (await this.dataSource.query(
      `WITH consumed AS (
         DELETE FROM verification WHERE identifier = $1
         RETURNING id, value, expires_at, created_at
       )
       SELECT id, value, expires_at AS "expiresAt", created_at AS "createdAt"
       FROM consumed ORDER BY created_at DESC LIMIT 1`,
      [identifier],
    )) as Pick<VerificationEntity, "id" | "value" | "expiresAt" | "createdAt">[];
    if (!latest || latest.expiresAt < new Date()) return null;
    return { ...latest, identifier, updatedAt: latest.createdAt };
  }
}
