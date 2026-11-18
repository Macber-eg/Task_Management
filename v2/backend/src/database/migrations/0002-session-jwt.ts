import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Lets the `session` table back rotating refresh tokens. The columns are
 * additive, so the previous backend can still run against the database.
 *
 * - `kind`: `browser` (cookie login), `device` (CLI) or `mcp`.
 * - `previous_token` / `rotated_at`: the refresh token replaced by the last
 *   rotation, accepted for a short grace window so two tabs refreshing at
 *   once do not log each other out, and treated as theft after it.
 */
export class SessionJwt1793000000001 implements MigrationInterface {
  name = "SessionJwt1793000000001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.session
        ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'browser',
        ADD COLUMN IF NOT EXISTS previous_token text,
        ADD COLUMN IF NOT EXISTS rotated_at timestamp without time zone
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE public.session
        DROP COLUMN IF EXISTS rotated_at,
        DROP COLUMN IF EXISTS previous_token,
        DROP COLUMN IF EXISTS kind
    `);
  }
}
