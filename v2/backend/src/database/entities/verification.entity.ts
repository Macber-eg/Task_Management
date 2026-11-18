import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "verification" })
export class VerificationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "identifier", type: "text" })
  identifier: string;

  @Column({ name: "value", type: "text" })
  value: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;

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
}
