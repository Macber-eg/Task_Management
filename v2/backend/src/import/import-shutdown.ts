import { type BeforeApplicationShutdown, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ActiveImports } from "./active-imports";
import { stopActiveImports } from "./runs/stop-active-imports";

/** Stops background imports before the database connection closes. */
@Injectable()
export class ImportShutdown implements BeforeApplicationShutdown {
  constructor(
    private readonly imports: ActiveImports,
    private readonly dataSource: DataSource,
  ) {}

  beforeApplicationShutdown(): Promise<void> {
    return stopActiveImports(this.imports, this.dataSource.manager);
  }
}
