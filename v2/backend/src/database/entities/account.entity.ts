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

@Entity({ name: "account" })
export class AccountEntity {
  @PrimaryColumn({ name: "id", type: "text" })
  id: string;

  @Column({ name: "account_id", type: "text" })
  accountId: string;

  @Column({ name: "provider_id", type: "text" })
  providerId: string;

  @Column({ name: "user_id", type: "text" })
  userId: string;

  @ManyToOne(() => UserEntity, (user) => user.accounts, {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id", referencedColumnName: "id" })
  user?: Relation<UserEntity>;

  @Column({ name: "access_token", type: "text", nullable: true })
  accessToken: string | null;

  @Column({ name: "refresh_token", type: "text", nullable: true })
  refreshToken: string | null;

  @Column({ name: "id_token", type: "text", nullable: true })
  idToken: string | null;

  @Column({
    name: "access_token_expires_at",
    type: "timestamp",
    nullable: true,
  })
  accessTokenExpiresAt: Date | null;

  @Column({
    name: "refresh_token_expires_at",
    type: "timestamp",
    nullable: true,
  })
  refreshTokenExpiresAt: Date | null;

  @Column({ name: "scope", type: "text", nullable: true })
  scope: string | null;

  @Column({ name: "password", type: "text", nullable: true })
  password: string | null;

  @Column({
    name: "created_at",
    type: "timestamp",
    default: () => "(now() AT TIME ZONE 'utc')",
  })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt: Date;
}
