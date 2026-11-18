import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AccountEntity } from "../database/entities/account.entity";

/**
 * The ID token stored at the user's last sign-in with the generic provider;
 * the web app passes it as `id_token_hint` when logging out of that provider.
 */
@Injectable()
export class IdTokenService {
  constructor(private readonly dataSource: DataSource) {}

  async getIdToken(userId: string): Promise<{ idToken: string | null }> {
    const account = await this.dataSource.manager.findOne(AccountEntity, {
      select: { id: true, idToken: true },
      where: { userId, providerId: "custom" },
    });
    return { idToken: account?.idToken ?? null };
  }
}
