import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, Principal } from "../auth/principal";
import type { SessionEntity } from "../database/entities/session.entity";
import type { UserEntity } from "../database/entities/user.entity";
import { UserSessionHandler } from "./user-session.handler";

const user = { id: "user-1" } as UserEntity;
const session = { id: "session-1" } as SessionEntity;

function requestFrom(principal: Principal | undefined) {
  const setHeader = vi.fn();
  const request = { principal, res: { setHeader } } as unknown as ApiRequest;
  return { request, setHeader };
}

const sessionRequired = {
  status: 403,
  code: "SESSION_REQUIRED",
  message: "A user session is required",
};

describe("UserSessionHandler", () => {
  const handler = new UserSessionHandler();

  it("lets a browser session through and forbids caching the response", async () => {
    const { request, setHeader } = requestFrom({
      userId: user.id,
      userEmail: "user@example.com",
      user,
      session,
    });

    await expect(handler.check(request)).resolves.toBeUndefined();
    expect(setHeader).toHaveBeenCalledExactlyOnceWith(
      "Cache-Control",
      "no-store",
    );
  });

  it("refuses an API key, uncached, even if it carries a session", async () => {
    const apiKey = {
      id: "key-1",
      userId: user.id,
      enabled: true,
      permissions: null,
    };
    for (const principal of [
      { userId: user.id, userEmail: "", user: null, session: null, apiKey },
      { userId: user.id, userEmail: "", user, session, apiKey },
    ]) {
      const { request, setHeader } = requestFrom(principal);

      await expect(handler.check(request)).rejects.toMatchObject(
        sessionRequired,
      );
      expect(setHeader).toHaveBeenCalledExactlyOnceWith(
        "Cache-Control",
        "no-store",
      );
    }
  });

  it.each([
    ["no caller", undefined],
    [
      "no session",
      { userId: user.id, userEmail: "", user, session: null } as Principal,
    ],
    [
      "no user",
      { userId: user.id, userEmail: "", user: null, session } as Principal,
    ],
  ])("refuses a request with %s", async (_label, principal) => {
    await expect(
      handler.check(requestFrom(principal).request),
    ).rejects.toMatchObject(sessionRequired);
  });
});
