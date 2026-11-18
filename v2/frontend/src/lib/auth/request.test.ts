import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRequest, onAuthCallSucceeded } from "./request";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, statusText: "Status" }),
  );
}

describe("authRequest", () => {
  it("returns data with revived dates and notifies listeners", async () => {
    const listener = vi.fn();
    const unsubscribe = onAuthCallSucceeded(listener);
    respond(200, { user: { createdAt: "2026-01-01T00:00:00.000Z" } });

    const result = await authRequest<{ user: { createdAt: Date } }>(
      "/sign-in/email",
      { method: "POST", body: { email: "a@b.c", password: "x" } },
    );

    expect(result.error).toBeNull();
    expect(result.data?.user.createdAt).toBeInstanceOf(Date);
    expect(listener).toHaveBeenCalledWith("/sign-in/email");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://api.test/api/auth/sign-in/email");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"email":"a@b.c","password":"x"}');
    unsubscribe();
  });

  it("puts query values in the URL for GET and sends no body", async () => {
    respond(200, []);

    await authRequest("/organization/list-members", {
      query: { organizationId: "w1", limit: 10, offset: undefined },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "http://api.test/api/auth/organization/list-members?organizationId=w1&limit=10",
    );
    expect(init?.body).toBeUndefined();
  });

  it("returns the body and status as the error", async () => {
    const onError = vi.fn();
    respond(403, { message: "Nope", code: "FORBIDDEN" });

    const result = await authRequest("/organization/delete", {
      method: "POST",
      fetchOptions: { onError },
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      message: "Nope",
      code: "FORBIDDEN",
      status: 403,
    });
    expect(onError).toHaveBeenCalled();
  });

  it("follows a redirect answer", async () => {
    const location = { href: "http://localhost/" };
    vi.stubGlobal("location", location);
    vi.spyOn(window, "location", "get").mockReturnValue(
      location as unknown as Location,
    );
    respond(200, { url: "https://idp.test/authorize", redirect: true });

    await authRequest("/sign-in/social", { method: "POST" });

    expect(location.href).toBe("https://idp.test/authorize");
  });

  it("does not follow unsafe redirect schemes", async () => {
    const location = { href: "http://localhost/" };
    vi.spyOn(window, "location", "get").mockReturnValue(
      location as unknown as Location,
    );
    respond(200, { url: "javascript:alert(1)", redirect: true });

    await authRequest("/sign-in/social", { method: "POST" });

    expect(location.href).toBe("http://localhost/");
  });
});
