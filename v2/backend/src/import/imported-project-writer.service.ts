import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EventBus } from "../events/event-bus";
import type { ImportedProject, ImportSourceId } from "../importers";
import type { ImportCounts } from "./import-run-project";
import { createImportProject } from "./writer/create-import-project";
import { writeProjectContent } from "./writer/write-project-content";

export type WriteImportedProjectInput = {
  workspaceId: string;
  userId: string;
  source: ImportSourceId;
  project: ImportedProject;
  includeComments: boolean;
};

export type WrittenImportProject = {
  projectId: string;
  projectSlug: string;
  counts: ImportCounts;
  warnings: string[];
};

/**
 * Saves one source project as a new Kaneo project. Its tasks are written
 * directly, so they send no notifications and trigger no integrations.
 */
@Injectable()
export class ImportedProjectWriter {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
  ) {}

  async write({
    workspaceId,
    userId,
    source,
    project,
    includeComments,
  }: WriteImportedProjectInput): Promise<WrittenImportProject> {
    const written = await createImportProject(
      this.dataSource,
      {
        workspaceId,
        name: project.name.trim() || "Untitled project",
        userId,
        preferredKey: project.key,
      },
      async (tx, created) => ({
        projectId: created.id,
        projectSlug: created.slug,
        ...(await writeProjectContent(tx, {
          projectId: created.id,
          workspaceId,
          userId,
          source,
          project,
          includeComments,
        })),
      }),
    );

    await this.events.publish("project.updated", {
      projectId: written.projectId,
    });

    return written;
  }
}
