import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "project_bookmark" })
export class ProjectBookmarkEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "project_id", type: "text" })
  projectId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @Column({ name: "title", type: "text" })
  title: string;

  @Column({ name: "url", type: "text" })
  url: string;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "(timezone('utc', now()))",
  })
  updatedAt: Date;
}
