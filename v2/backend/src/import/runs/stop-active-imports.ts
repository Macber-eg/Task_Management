import type { EntityManager } from "typeorm";
import { ImportRunEntity } from "../../database/entities/import-run.entity";
import type { ActiveImports } from "../active-imports";
import {
  failUnfinishedProjects,
  type ImportRunProject,
} from "../import-run-project";
import { logImportError } from "../log-import-error";

export const RESTART_ERROR = "Kaneo restarted during the import.";

const SHUTDOWN_GRACE_MS = 5_000;

async function markStopped(
  manager: EntityManager,
  runId: string,
  projects: ImportRunProject[],
) {
  try {
    await manager.update(
      ImportRunEntity,
      { id: runId, status: "running" },
      {
        status: "failed",
        error: RESTART_ERROR,
        message: null,
        projects: failUnfinishedProjects(projects, RESTART_ERROR),
        finishedAt: new Date(),
      },
    );
  } catch (error) {
    logImportError("Failed to mark an import as stopped", runId, error);
  }
}

function settledBefore(deadline: Promise<void>, promises: unknown[]) {
  return Promise.race([Promise.allSettled(promises), deadline]);
}

/**
 * Refuses new imports, gives running ones a short grace period, then aborts
 * them and records the runs that did not finish as stopped by the restart.
 */
export async function stopActiveImports(
  imports: ActiveImports,
  manager: EntityManager,
  graceMs = SHUTDOWN_GRACE_MS,
) {
  imports.stopAccepting();
  if (imports.active().length === 0) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, graceMs);
  });

  await settledBefore(
    deadline,
    imports.active().map((slot) => slot.settled),
  );

  const slots = imports.active();
  for (const slot of slots) slot.controller.abort(new Error(RESTART_ERROR));
  await settledBefore(
    deadline,
    slots.map((slot) => slot.job),
  );
  clearTimeout(timer);

  await Promise.all(
    imports
      .active()
      .flatMap((slot) =>
        slot.runId ? [markStopped(manager, slot.runId, slot.projects())] : [],
      ),
  );
}
