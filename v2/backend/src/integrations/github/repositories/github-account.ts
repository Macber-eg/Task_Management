import type { EntityManager } from "typeorm";
import { HTTPException } from "../../../common/errors/http-exception";
import { AccountEntity } from "../../../database/entities/account.entity";

/** The caller's linked GitHub account; its id comes from completed OAuth. */
export async function getGithubAccount(
  db: EntityManager,
  userId: string,
): Promise<AccountEntity> {
  const account = await db.findOne(AccountEntity, {
    where: { userId, providerId: "github" },
  });
  const accountId = Number(account?.accountId);
  if (!account || !Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new HTTPException(403, {
      message: "Connect your GitHub account before linking a repository",
    });
  }
  return account;
}
