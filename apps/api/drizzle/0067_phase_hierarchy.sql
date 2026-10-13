ALTER TABLE "project_phase" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "project_phase" ADD COLUMN "kind" text DEFAULT 'folder' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_phase" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_parent_id_project_phase_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_phase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_phase_parentId_idx" ON "project_phase" USING btree ("parent_id");
