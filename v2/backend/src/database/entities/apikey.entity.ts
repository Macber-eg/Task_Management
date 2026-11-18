import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import { UserEntity } from "./user.entity";

@Entity({ name: "apikey" })
export class ApikeyEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "config_id", type: "text", default: "default" })
  configId: string;

  @Column({ name: "name", type: "text", nullable: true })
  name: string | null;

  @Column({ name: "start", type: "text", nullable: true })
  start: string | null;

  @Column({ name: "reference_id", type: "text" })
  referenceId: string;

  @ManyToOne(() => UserEntity, (user) => user.apikeys, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "reference_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "prefix", type: "text", nullable: true })
  prefix: string | null;

  @Column({ name: "key", type: "text" })
  key: string;

  @Column({ name: "user_id", type: "text", nullable: true })
  userId: string | null;

  @Column({ name: "refill_interval", type: "integer", nullable: true })
  refillInterval: number | null;

  @Column({ name: "refill_amount", type: "integer", nullable: true })
  refillAmount: number | null;

  @Column({ name: "last_refill_at", type: "timestamp", nullable: true })
  lastRefillAt: Date | null;

  @Column({ name: "enabled", type: "boolean", nullable: true, default: true })
  enabled: boolean | null;

  @Column({
    name: "rate_limit_enabled",
    type: "boolean",
    nullable: true,
    default: true,
  })
  rateLimitEnabled: boolean | null;

  @Column({
    name: "rate_limit_time_window",
    type: "integer",
    nullable: true,
    default: 86400000,
  })
  rateLimitTimeWindow: number | null;

  @Column({
    name: "rate_limit_max",
    type: "integer",
    nullable: true,
    default: 10,
  })
  rateLimitMax: number | null;

  @Column({
    name: "request_count",
    type: "integer",
    nullable: true,
    default: 0,
  })
  requestCount: number | null;

  @Column({ name: "remaining", type: "integer", nullable: true })
  remaining: number | null;

  @Column({ name: "last_request", type: "timestamp", nullable: true })
  lastRequest: Date | null;

  @Column({ name: "expires_at", type: "timestamp", nullable: true })
  expiresAt: Date | null;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt: Date;

  @Column({ name: "updated_at", type: "timestamp" })
  updatedAt: Date;

  @Column({ name: "permissions", type: "text", nullable: true })
  permissions: string | null;

  @Column({ name: "metadata", type: "text", nullable: true })
  metadata: string | null;
}
