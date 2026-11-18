import { Injectable } from "@nestjs/common";
import { HTTPException } from "../common/errors/http-exception";
import type { ImportRunProject } from "./import-run-project";

export const MAX_ACTIVE_IMPORTS = 2;

export const RESTARTING_MESSAGE =
  "Kaneo is restarting. Start the import again in a minute.";

export type ImportSlot = {
  controller: AbortController;
  runId: string | null;
  job: Promise<void> | null;
  projects: () => ImportRunProject[];
  settled: Promise<void>;
};

/**
 * The imports this server is running: at most `MAX_ACTIVE_IMPORTS`, from the
 * moment a start request reserves a slot until its background job ends.
 */
@Injectable()
export class ActiveImports {
  private readonly slots = new Map<ImportSlot, () => void>();
  private shuttingDown = false;

  /** A free slot, null when the server is full; throws 503 while shutting down. */
  reserve(): ImportSlot | null {
    if (this.shuttingDown) {
      throw new HTTPException(503, { message: RESTARTING_MESSAGE });
    }
    if (this.slots.size >= MAX_ACTIVE_IMPORTS) return null;

    let settle: () => void = () => {};
    const slot: ImportSlot = {
      controller: new AbortController(),
      runId: null,
      job: null,
      projects: () => [],
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    this.slots.set(slot, settle);
    return slot;
  }

  release(slot: ImportSlot) {
    this.slots.get(slot)?.();
    this.slots.delete(slot);
  }

  track(
    slot: ImportSlot,
    runId: string,
    job: Promise<void>,
    projects: () => ImportRunProject[],
  ) {
    slot.runId = runId;
    slot.projects = projects;
    slot.job = job.finally(() => this.release(slot));
    this.slots.get(slot)?.();
  }

  stopAccepting() {
    this.shuttingDown = true;
  }

  active(): ImportSlot[] {
    return [...this.slots.keys()];
  }

  async waitForAll() {
    await Promise.allSettled(this.active().map((slot) => slot.job));
  }
}
