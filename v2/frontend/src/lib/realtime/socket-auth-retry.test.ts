import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshSession } = vi.hoisted(() => ({
  refreshSession: vi.fn<() => Promise<boolean>>(),
}));
vi.mock("@/lib/api/refresh-session", () => ({ refreshSession }));

import { createSocketAuthRetry, WS_AUTH_EXPIRED } from "./socket-auth-retry";

beforeEach(() => {
  refreshSession.mockReset();
  refreshSession.mockResolvedValue(true);
});

describe("createSocketAuthRetry", () => {
  it("refreshes once when a socket closes before opening", async () => {
    const retry = createSocketAuthRetry();

    await expect(retry.refreshFor(1006, false)).resolves.toBe(true);
    expect(retry.refreshFor(1006, false)).toBeNull();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("refreshes on the auth-expired close code even after opening", async () => {
    const retry = createSocketAuthRetry();

    await expect(retry.refreshFor(WS_AUTH_EXPIRED, true)).resolves.toBe(true);
  });

  it("leaves ordinary closes of an open socket to the normal retry", () => {
    const retry = createSocketAuthRetry();

    expect(retry.refreshFor(1006, true)).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("allows another refresh after a socket opens", () => {
    const retry = createSocketAuthRetry();

    void retry.refreshFor(1006, false);
    retry.opened();
    void retry.refreshFor(WS_AUTH_EXPIRED, true);

    expect(refreshSession).toHaveBeenCalledTimes(2);
  });
});
