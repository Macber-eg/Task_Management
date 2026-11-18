import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrationInterface, QueryRunner } from "typeorm";
import { assertAdoptableSchema } from "./preflight";
import { detectSchemaState } from "./schema-state";

/**
 * Adopts a database built by the previous backend without touching it, or
 * creates the identical schema on an empty one. `baseline.sql` is a
 * structure-only dump of that schema, including the storage cleanup trigger
 * function, partial indexes and composite foreign keys.
 */
export class Baseline1793000000000 implements MigrationInterface {
  name = "Baseline1793000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    const state = await detectSchemaState(queryRunner);

    if (state === "current") {
      await assertAdoptableSchema(queryRunner);
      return;
    }

    if (state === "empty") {
      await queryRunner.query(
        readFileSync(join(__dirname, "baseline.sql"), "utf8"),
      );
      return;
    }

    throw new Error(
      state === "outdated"
        ? "This database was built by an older release. Upgrade it with the previous backend (2.40.0) first, start that backend once, then retry."
        : "This database has tables but no recognizable migration history, so it is neither empty nor adoptable.",
    );
  }

  async down(): Promise<void> {
    throw new Error("The baseline migration cannot be reverted.");
  }
}
