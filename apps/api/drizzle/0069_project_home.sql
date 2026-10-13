CREATE TABLE IF NOT EXISTS "project_bookmark" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "created_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL,
  "updated_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL
);

CREATE INDEX IF NOT EXISTS "project_bookmark_project_user_idx"
  ON "project_bookmark" ("project_id", "user_id");

CREATE TABLE IF NOT EXISTS "project_recent_access" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "item_type" text NOT NULL,
  "item_id" text NOT NULL,
  "title" text NOT NULL,
  "parent_label" text,
  "accessed_at" timestamp DEFAULT (timezone('utc', now())) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_recent_access_unique"
  ON "project_recent_access" ("project_id", "user_id", "item_type", "item_id");
CREATE INDEX IF NOT EXISTS "project_recent_access_user_project_idx"
  ON "project_recent_access" ("project_id", "user_id", "accessed_at");
