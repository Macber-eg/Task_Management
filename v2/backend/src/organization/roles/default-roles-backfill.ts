import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { seedDefaultRoles } from "./seed-default-roles";

/**
 * Gives every workspace the default roles at startup. Workspaces created
 * before those roles became editable rows have none, and without them their
 * admins, members and viewers would hold no permissions at all.
 */
@Injectable()
export class DefaultRolesBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefaultRolesBackfill.name);

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const workspaces = (await this.dataSource.query(
      "SELECT id FROM workspace",
    )) as { id: string }[];
    const seeded = await seedDefaultRoles(
      this.dataSource.manager,
      workspaces.map((workspace) => workspace.id),
    );
    if (seeded > 0) {
      this.logger.log(
        `Seeded ${seeded} default workspace role row(s) across ${workspaces.length} workspace(s).`,
      );
    }
  }
}
