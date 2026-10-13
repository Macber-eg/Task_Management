ALTER TABLE "project_sprint" ADD COLUMN "phase_id" text;--> statement-breakpoint
ALTER TABLE "project_sprint" ADD CONSTRAINT "project_sprint_phase_id_project_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phase"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "project_sprint_phaseId_idx" ON "project_sprint" USING btree ("phase_id");
