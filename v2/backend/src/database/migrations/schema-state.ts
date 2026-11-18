import type { QueryRunner } from "typeorm";

/** `when` of the last Drizzle migration (0069_project_home) in its journal. */
const LAST_DRIZZLE_MIGRATION_AT = 1_792_500_000_000n;

export type SchemaState = "empty" | "current" | "outdated" | "unknown";

type Probe = { drizzle: string | null; users: string | null };

/**
 * Tells an empty database from one the previous (Drizzle) backend built.
 * Only a database whose Drizzle history reaches the last migration is safe to
 * adopt as-is.
 */
export async function detectSchemaState(
  queryRunner: QueryRunner,
): Promise<SchemaState> {
  const [probe] = (await queryRunner.query(
    `select to_regclass('drizzle.__drizzle_migrations')::text as drizzle,
            to_regclass('public."user"')::text as users`,
  )) as Probe[];

  if (probe?.drizzle) {
    const [row] = (await queryRunner.query(
      "select max(created_at)::text as latest from drizzle.__drizzle_migrations",
    )) as { latest: string | null }[];
    const latest = row?.latest ? BigInt(row.latest) : 0n;
    return latest >= LAST_DRIZZLE_MIGRATION_AT ? "current" : "outdated";
  }

  return probe?.users ? "unknown" : "empty";
}
