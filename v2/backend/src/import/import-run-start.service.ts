import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { HTTPException } from "../common/errors/http-exception";
import { eventContext } from "../events/event-context";
import type { SourceProject } from "../importers";
import {
  ActiveImports,
  type ImportSlot,
  MAX_ACTIVE_IMPORTS,
} from "./active-imports";
import { ImportedProjectWriter } from "./imported-project-writer.service";
import { logImportError } from "./log-import-error";
import { type ImportJobState, runImportJob } from "./run-import-job";
import { assertNoRunningImport } from "./runs/assert-no-running-import";
import { createImportRun } from "./runs/create-import-run";
import { toImportRunResponse } from "./runs/to-import-run-response";
import { updateRunningRun } from "./runs/update-running-run";
import type { ImportConnectionInput } from "./schema";
import {
  importHttpError,
  type OpenedImportSource,
  openImportSource,
} from "./source/open-import-source";
import { selectSourceProjects } from "./source/select-source-projects";

const CONNECT_TIMEOUT_MS = 90_000;

type StartImportRunInput = {
  workspaceId: string;
  userId: string;
  connection: ImportConnectionInput;
  projectIds: string[];
  includeComments: boolean;
};

async function connectAndList(
  slot: ImportSlot,
  connection: ImportConnectionInput,
): Promise<{ opened: OpenedImportSource; available: SourceProject[] }> {
  const timer = setTimeout(() => {
    slot.controller.abort(
      new DOMException("The source took too long to answer.", "TimeoutError"),
    );
  }, CONNECT_TIMEOUT_MS);

  try {
    const opened = await openImportSource(connection, slot.controller.signal);
    try {
      return { opened, available: await opened.source.listProjects() };
    } catch (error) {
      throw importHttpError(opened.describe(error));
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Validates the selection, records the run and starts it in the background. */
@Injectable()
export class ImportRunStartService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly imports: ActiveImports,
    private readonly writer: ImportedProjectWriter,
  ) {}

  async startImportRun({
    workspaceId,
    userId,
    connection,
    projectIds,
    includeComments,
  }: StartImportRunInput) {
    const slot = this.imports.reserve();
    if (!slot) {
      throw new HTTPException(429, {
        message: `This Kaneo server is already running ${MAX_ACTIVE_IMPORTS} imports. Try again when one of them finishes.`,
      });
    }

    try {
      await assertNoRunningImport(this.dataSource.manager, workspaceId);
      const { opened, available } = await connectAndList(slot, connection);
      const projects = selectSourceProjects(
        projectIds,
        available,
        opened.sourceName,
      );

      const run = await createImportRun(this.dataSource, {
        workspaceId,
        userId,
        source: opened.sourceId,
        includeComments,
        projects,
      });

      const state: ImportJobState = { projects: run.projects };
      // The job outlives the request; its events have no initiator.
      const job = eventContext.exit(() =>
        runImportJob(
          {
            runId: run.id,
            workspaceId,
            userId,
            includeComments,
            opened,
            state,
            signal: slot.controller.signal,
          },
          {
            writeRun: (runId, changes) =>
              updateRunningRun(this.dataSource.manager, runId, changes),
            writeProject: (input) => this.writer.write(input),
          },
        ),
      );
      this.imports.track(
        slot,
        run.id,
        job.catch((error) =>
          logImportError("Import job crashed", run.id, error),
        ),
        () => state.projects,
      );

      return toImportRunResponse(run);
    } catch (error) {
      this.imports.release(slot);
      throw error;
    }
  }
}
