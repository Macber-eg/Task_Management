import type { EntityManager } from "typeorm";
import { ApikeyEntity } from "../../database/entities/apikey.entity";
import { apiKeyError } from "./api-key-error";

/**
 * A key the user owns. Someone else's key answers the same 404 as a missing
 * one, so key ids cannot be probed.
 */
export async function findOwnApiKey(
  manager: EntityManager,
  id: string,
  userId: string,
): Promise<ApikeyEntity> {
  const apiKey = await manager.findOne(ApikeyEntity, { where: { id } });
  if (
    !apiKey ||
    apiKey.configId !== "default" ||
    apiKey.referenceId !== userId
  ) {
    throw apiKeyError("KEY_NOT_FOUND");
  }
  return apiKey;
}
