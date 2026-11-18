import type { EntityManager } from "typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "../../common/errors/http-exception";
import { ActiveImports } from "../active-imports";
import { pendingRunProject } from "../import-run-project";
import { RESTART_ERROR, stopActiveImports } from "./stop-active-imports";

const update = vi.fn(async () => undefined);
const manager = { update } as unknown as EntityManager;

let registry: ActiveImports;

function reserve() {
  const slot = registry.reserve();
  if (!slot) throw new Error("expected a free slot");
  return slot;
}

function untilAborted(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve());
  });
}

describe("stopActiveImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ActiveImports();
  });

  it("refuses new imports even when nothing is running", async () => {
    await stopActiveImports(registry, manager, 10);

    expect(() => registry.reserve()).toThrow(HTTPException);
    expect(update).not.toHaveBeenCalled();
  });

  it("waits for a start request that is still connecting, then stops its job", async () => {
    const slot = reserve();
    const stopping = stopActiveImports(registry, manager, 1_000);
    expect(() => registry.reserve()).toThrow(HTTPException);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(slot.controller.signal.aborted).toBe(false);

    registry.track(slot, "run-1", untilAborted(slot.controller.signal), () => []);
    await stopping;

    expect(slot.controller.signal.aborted).toBe(true);
    expect(registry.active()).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it("marks a run stopped when its job does not finish in time", async () => {
    const slot = reserve();
    registry.track(slot, "run-1", new Promise(() => {}), () => [
      { ...pendingRunProject("a", "Alpha"), status: "running" },
    ]);

    await stopActiveImports(registry, manager, 10);

    expect(slot.controller.signal.aborted).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      { id: "run-1", status: "running" },
      expect.objectContaining({
        status: "failed",
        error: RESTART_ERROR,
        projects: [
          expect.objectContaining({
            status: "failed",
            error: RESTART_ERROR,
          }),
        ],
      }),
    );
  });

  it("stops waiting for a reservation after the grace period", async () => {
    const slot = reserve();

    await stopActiveImports(registry, manager, 10);

    expect(slot.controller.signal.aborted).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
