import { beforeEach, describe, expect, it } from "vitest";
import { HTTPException } from "../common/errors/http-exception";
import { ActiveImports, MAX_ACTIVE_IMPORTS } from "./active-imports";

let registry: ActiveImports;

function reserve() {
  const slot = registry.reserve();
  if (!slot) throw new Error("expected a free slot");
  return slot;
}

async function hasSettled(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return settled;
}

describe("active imports", () => {
  beforeEach(() => {
    registry = new ActiveImports();
  });

  it("reserves up to the server limit", () => {
    const first = reserve();
    for (let count = 1; count < MAX_ACTIVE_IMPORTS; count++) {
      reserve();
    }

    expect(registry.reserve()).toBeNull();

    registry.release(first);
    expect(registry.reserve()).not.toBeNull();
  });

  it("settles a reservation once its job is attached", async () => {
    const slot = reserve();

    expect(await hasSettled(slot.settled)).toBe(false);

    registry.track(slot, "run-1", new Promise(() => {}), () => []);

    expect(await hasSettled(slot.settled)).toBe(true);
    expect(registry.active()).toEqual([slot]);
  });

  it("settles a reservation that is released without a job", async () => {
    const slot = reserve();

    registry.release(slot);

    expect(await hasSettled(slot.settled)).toBe(true);
    expect(registry.active()).toEqual([]);
  });

  it("frees the slot when the job finishes", async () => {
    const slot = reserve();

    registry.track(slot, "run-1", Promise.resolve(), () => []);
    await registry.waitForAll();

    expect(registry.active()).toEqual([]);
  });

  it("refuses new reservations once the server is shutting down", () => {
    registry.stopAccepting();

    let refused: unknown;
    try {
      registry.reserve();
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(HTTPException);
    expect(refused).toMatchObject({
      status: 503,
      message: "Kaneo is restarting. Start the import again in a minute.",
    });
    expect(registry.active()).toEqual([]);
  });
});
