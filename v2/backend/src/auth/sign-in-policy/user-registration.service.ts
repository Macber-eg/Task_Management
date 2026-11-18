import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning } from "../../database/dml";
import { UserEntity } from "../../database/entities/user.entity";
import { authError } from "../auth-error";
import { InstanceBootstrapService } from "../instance/instance-bootstrap.service";
import { assertUserRegistrationAllowed } from "../registration/registration-policy";

export type NewUser = {
  email: string;
  name: string;
  emailVerified: boolean;
  isAnonymous?: boolean;
  image?: string | null;
  locale?: string | null;
};

export type RegistrationContext = {
  /** The auth route creating the account, relative to `/api/auth`. */
  path: string;
  invitationId?: unknown;
};

/**
 * Creates an account the way every path did in the previous backend: the
 * registration policy runs first, the instance role defaults to `user`, and
 * the first real account becomes the instance administrator.
 */
@Injectable()
export class UserRegistrationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly bootstrap: InstanceBootstrapService,
  ) {}

  async create(user: NewUser, context: RegistrationContext): Promise<UserEntity> {
    const email = user.email.toLowerCase();
    const manager = this.dataSource.manager;
    await assertUserRegistrationAllowed(
      manager,
      { email, emailVerified: user.emailVerified, isAnonymous: user.isAnonymous },
      context,
    );

    const now = new Date();
    const created = await insertReturning(manager, UserEntity, {
      email,
      name: user.name,
      emailVerified: user.emailVerified,
      isAnonymous: user.isAnonymous ?? false,
      image: user.image ?? null,
      locale: user.locale ?? null,
      role: "user",
      createdAt: now,
      updatedAt: now,
    });
    if (!created) throw authError("FAILED_TO_CREATE_USER");

    // Guests never take the administrator slot.
    if (!created.isAnonymous) {
      await this.bootstrap.promoteInitialAdministrator(created.id);
    }
    return (
      (await manager.findOne(UserEntity, { where: { id: created.id } })) ??
      created
    );
  }
}
