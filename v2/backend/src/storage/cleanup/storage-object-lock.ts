import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { insertReturning } from "../../database/dml";
import { JobLeaseEntity } from "../../database/entities/job-lease.entity";
import { StorageCleanupEntity } from "../../database/entities/storage-cleanup.entity";

const LEASE_MS = 60_000;

export function verificationLeaseName(objectKey: string) {
  return `storage-verification:${objectKey}`;
}

/**
 * Serializes everything that decides an object's fate (reference changes,
 * verification leases, cleanup) per object key.
 */
@Injectable()
export class StorageObjectLock {
  constructor(private readonly dataSource: DataSource) {}

  /** Runs `apply` in a transaction holding the object's advisory lock. */
  withObject<T>(
    objectKey: string,
    apply: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('storage-object'), hashtext($1))",
        [objectKey],
      );
      return apply(manager);
    });
  }

  /**
   * A durable lease protects the object from cleanup while `verify` runs
   * without holding a pooled connection; `apply` then records the result
   * under the object lock, unless the lease expired meanwhile.
   */
  withVerifiedObject<Verified, Result>(
    objectKey: string,
    verify: () => Promise<Verified>,
    apply: (manager: EntityManager, verified: Verified) => Promise<Result>,
  ): Promise<Result> {
    return this.leased(objectKey, false, verify, apply);
  }

  /**
   * Like `withVerifiedObject`, for an object the API writes itself: a cleanup
   * intent is recorded with the lease, before `upload` runs, and removed only
   * once `apply` has stored a reference. A crash or failure anywhere between
   * leaves the intent, so the cleanup queue removes the orphaned object.
   */
  withUploadedObject<Result>(
    objectKey: string,
    upload: () => Promise<void>,
    apply: (manager: EntityManager) => Promise<Result>,
  ): Promise<Result> {
    return this.leased(objectKey, true, upload, async (manager) => {
      const result = await apply(manager);
      await manager.delete(StorageCleanupEntity, { objectKey });
      return result;
    });
  }

  private async leased<Verified, Result>(
    objectKey: string,
    recordIntent: boolean,
    verify: () => Promise<Verified>,
    apply: (manager: EntityManager, verified: Verified) => Promise<Result>,
  ): Promise<Result> {
    const name = verificationLeaseName(objectKey);
    const owner = randomUUID();
    await this.withObject(objectKey, async (manager) => {
      const current = await manager.findOne(JobLeaseEntity, {
        where: { name },
      });
      if (current && current.expiresAt > new Date())
        throw new HTTPException(503, {
          message: "Upload verification is already in progress.",
        });
      await insertReturning(
        manager,
        JobLeaseEntity,
        { name, owner, expiresAt: new Date(Date.now() + LEASE_MS) },
        { onConflict: { target: ["name"], update: ["owner", "expiresAt"] } },
      );
      if (recordIntent) {
        await insertReturning(
          manager,
          StorageCleanupEntity,
          { objectKey },
          { onConflict: { target: ["objectKey"] } },
        );
      }
    });
    try {
      const verified = await verify();
      return await this.withObject(objectKey, async (manager) => {
        const lease = await manager.findOne(JobLeaseEntity, {
          where: { name },
        });
        if (lease?.owner !== owner || lease.expiresAt <= new Date())
          throw new HTTPException(503, {
            message: "Upload verification expired; retry the upload.",
          });
        const result = await apply(manager, verified);
        await manager.delete(JobLeaseEntity, { name, owner });
        return result;
      });
    } finally {
      await this.dataSource.manager.delete(JobLeaseEntity, { name, owner });
    }
  }
}
