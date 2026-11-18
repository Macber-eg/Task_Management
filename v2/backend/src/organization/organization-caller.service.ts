import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { authError } from "../auth/auth-error";
import type { Principal } from "../auth/principal";
import type { SessionEntity } from "../database/entities/session.entity";
import { UserEntity } from "../database/entities/user.entity";

/**
 * Who calls a workspace endpoint. An API key acts as its owner with no login
 * session, hence no active workspace, as it did in the previous backend.
 */
export type OrganizationCaller = {
  user: UserEntity;
  session: SessionEntity | null;
};

export function activeOrganizationOf(caller: OrganizationCaller) {
  return caller.session?.activeOrganizationId ?? null;
}

@Injectable()
export class OrganizationCallerService {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(principal: Principal): Promise<OrganizationCaller> {
    if (principal.user) {
      return { user: principal.user, session: principal.session };
    }
    const user = await this.dataSource.manager.findOne(UserEntity, {
      where: { id: principal.userId },
    });
    if (!user) throw authError("UNAUTHORIZED");
    return { user, session: null };
  }
}
