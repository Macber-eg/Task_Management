import type { EntityManager } from "typeorm";
import { InvitationEntity } from "../../../src/database/entities/invitation.entity";
import { insertRow } from "./insert-row";

/** A pending invitation that expires tomorrow, unless overridden. */
export function createInvitation(
  db: EntityManager,
  values: Partial<InvitationEntity> & {
    workspaceId: string;
    inviterId: string;
    email: string;
  },
): Promise<InvitationEntity> {
  return insertRow(db, InvitationEntity, {
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 86_400_000),
    ...values,
    email: values.email.toLowerCase(),
  });
}
