import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "data_migration" })
export class DataMigrationEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({
    name: "completed_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  completedAt: Date;
}
