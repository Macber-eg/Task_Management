import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "storage_cleanup" })
export class StorageCleanupEntity {
  @PrimaryColumn({ name: "object_key", type: "text" })
  objectKey: string;

  @Column({ name: "last_attempt_at", type: "timestamp", nullable: true })
  lastAttemptAt: Date | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;
}
