import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { insertReturning, updateReturning } from "../../database/dml";
import { AccountEntity } from "../../database/entities/account.entity";
import { freshTokenColumns, type OAuthAccountData } from "./oauth-identity";
import { redirectOnError } from "./oauth-redirect";

/**
 * Attaches a provider identity to the signed-in user who started a link flow.
 * An identity already attached to someone else stays theirs.
 */
@Injectable()
export class OAuthAccountLinkService {
  private readonly logger = new Logger(OAuthAccountLinkService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** Redirects to `errorURL` when the identity cannot be linked. */
  async link(
    userId: string,
    account: OAuthAccountData,
    errorURL: string,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(AccountEntity, {
      where: { accountId: account.accountId, providerId: account.providerId },
    });
    if (existing) {
      if (existing.userId !== userId) {
        redirectOnError(errorURL, "account_already_linked_to_different_user");
      }
      const columns = freshTokenColumns(account);
      if (Object.keys(columns).length > 0) {
        await updateReturning(manager, AccountEntity, columns, {
          id: existing.id,
        });
      }
      return;
    }

    let created: AccountEntity | undefined;
    try {
      created = await insertReturning(manager, AccountEntity, {
        ...account,
        userId,
      });
    } catch (error) {
      this.logger.error("Unable to link account", error);
    }
    if (!created) redirectOnError(errorURL, "unable_to_link_account");
  }
}
