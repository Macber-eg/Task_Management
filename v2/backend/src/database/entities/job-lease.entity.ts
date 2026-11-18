import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "job_lease" })
export class JobLeaseEntity {
  @PrimaryColumn({ name: "name", type: "text" })
  name: string;

  @Column({ name: "owner", type: "text" })
  owner: string;

  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt: Date;
}
