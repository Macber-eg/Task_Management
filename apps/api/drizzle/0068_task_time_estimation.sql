ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "estimated_minutes" integer;

CREATE TABLE IF NOT EXISTS "task_estimate_allocation" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "estimated_minutes" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL,
  "updated_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "task_estimate_allocation_task_user_unique"
  ON "task_estimate_allocation" ("task_id", "user_id");
CREATE INDEX IF NOT EXISTS "task_estimate_allocation_task_id_idx"
  ON "task_estimate_allocation" ("task_id");

CREATE TABLE IF NOT EXISTS "workspace_member_capacity" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "minutes_per_day" integer NOT NULL DEFAULT 480,
  "working_days_per_week" integer NOT NULL DEFAULT 5,
  "created_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL,
  "updated_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_member_capacity_workspace_user_unique"
  ON "workspace_member_capacity" ("workspace_id", "user_id");

CREATE TABLE IF NOT EXISTS "time_entry_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "time_entry_id" text NOT NULL,
  "task_id" text NOT NULL REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "action" text NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb,
  "created_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL
);

CREATE INDEX IF NOT EXISTS "time_entry_audit_time_entry_id_idx"
  ON "time_entry_audit" ("time_entry_id");
CREATE INDEX IF NOT EXISTS "time_entry_audit_task_id_idx"
  ON "time_entry_audit" ("task_id");
