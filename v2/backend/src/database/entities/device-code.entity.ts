import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: device_code_device_code_uidx (device_code); unique index, not constraint
// Unique: device_code_user_code_uidx (user_code); unique index, not constraint
@Entity({ name: "device_code" })
export class DeviceCodeEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "device_code", type: "text" })
  deviceCode: string;

  @Column({ name: "user_code", type: "text" })
  userCode: string;

  @Column({ name: "user_id", type: "text", nullable: true })
  userId: string | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  updatedAt: Date;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

  @Column({ name: "status", type: "text" })
  status: string;

  @Column({ name: "last_polled_at", type: "timestamp", nullable: true })
  lastPolledAt: Date | null;

  @Column({ name: "polling_interval", type: "integer", nullable: true })
  pollingInterval: number | null;

  @Column({ name: "client_id", type: "text", nullable: true })
  clientId: string | null;

  @Column({ name: "scope", type: "text", nullable: true })
  scope: string | null;
}
