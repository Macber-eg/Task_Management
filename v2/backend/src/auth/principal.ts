import type { Request } from "express";
import type { SessionEntity } from "../database/entities/session.entity";
import type { UserEntity } from "../database/entities/user.entity";

export type ApiKeyPrincipal = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
};

/**
 * The authenticated caller. For API keys `user` and `session` are null and
 * `userEmail` is empty, as in the previous API.
 */
export type Principal = {
  userId: string;
  userEmail: string;
  user: UserEntity | null;
  session: SessionEntity | null;
  apiKey?: ApiKeyPrincipal;
};

export type ApiRequest = Request & {
  principal?: Principal;
  /** Set by the workspace access rule once membership is verified. */
  workspaceId?: string;
};
