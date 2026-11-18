import type { QueryRunner } from "typeorm";

type Check = { description: string; sql: string };

// The previous backend finished its schema with startup fixups that ran after
// the SQL migrations. They are not ported, so an adopted database must show
// their results.
const CHECKS: Check[] = [
  {
    description: "apikey.reference_id is NOT NULL (apikey fixup ran)",
    sql: `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'apikey'
            and column_name = 'reference_id' and is_nullable = 'NO'`,
  },
  {
    description: "column workflow data migration is recorded",
    sql: "select 1 from data_migration where id = 'column-workflow-v1'",
  },
  {
    description: "legacy github_integration table was migrated and dropped",
    sql: "select 1 where to_regclass('public.github_integration') is null",
  },
  {
    description: "storage cleanup triggers exist",
    sql: `select 1 from pg_trigger
          where tgname in ('asset_storage_cleanup', 'project_storage_cleanup')
          having count(*) = 2`,
  },
];

export async function assertAdoptableSchema(
  queryRunner: QueryRunner,
): Promise<void> {
  const failures: string[] = [];
  for (const check of CHECKS) {
    const rows = (await queryRunner.query(check.sql)) as unknown[];
    if (rows.length === 0) failures.push(check.description);
  }
  if (failures.length > 0) {
    throw new Error(
      `This database cannot be adopted yet. Start the previous backend (2.40.0) once so it finishes its own upgrades, then retry. Failed checks: ${failures.join("; ")}`,
    );
  }
}
