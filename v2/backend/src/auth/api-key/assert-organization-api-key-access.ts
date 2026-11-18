import type { EntityManager } from "typeorm";
import { WorkspaceUserEntity } from "../../database/entities/workspace-user.entity";
import { apiKeyError } from "./api-key-error";

/**
 * Whether the user may read a workspace's API keys. Only its owners may;
 * no role, built in or custom, can be granted that otherwise.
 */
export async function assertOrganizationApiKeyAccess(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const member = await manager.findOne(WorkspaceUserEntity, {
    where: { userId, workspaceId },
  });
  if (!member) throw apiKeyError("USER_NOT_MEMBER_OF_ORGANIZATION");
  if (!member.role.split(",").includes("owner")) {
    throw apiKeyError("INSUFFICIENT_API_KEY_PERMISSIONS");
  }
}
