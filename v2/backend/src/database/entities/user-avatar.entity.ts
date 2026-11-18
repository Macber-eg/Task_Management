import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

// Unique: user_avatar_user_id_unique (user_id)
@Entity({ name: "user_avatar" })
export class UserAvatarEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "mime_type", type: "text" })
  mimeType: string;

  @Column({ name: "size", type: "integer" })
  size: number;

  @Column({ name: "data", type: "bytea" })
  data: Buffer;

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
