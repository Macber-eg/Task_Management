import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";
import { UserEntity } from "./user.entity";

@Entity({ name: "notification" })
export class NotificationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.notifications, {
    nullable: false,
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "title", type: "text", nullable: true })
  title: string | null;

  @Column({ name: "content", type: "text", nullable: true })
  content: string | null;

  @Column({ name: "type", type: "text", default: "info" })
  type: string;

  @Column({ name: "event_data", type: "jsonb", nullable: true })
  eventData: unknown;

  @Column({ name: "is_read", type: "boolean", nullable: true, default: false })
  isRead: boolean | null;

  @Column({ name: "resource_id", type: "text", nullable: true })
  resourceId: string | null;

  @Column({ name: "resource_type", type: "text", nullable: true })
  resourceType: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamptz",
    default: () => "now()",
  })
  updatedAt: Date;
}
