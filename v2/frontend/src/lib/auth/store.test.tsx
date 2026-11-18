import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function callsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path))
    .length;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", "http://api.test");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth store", () => {
  it("does not refetch the active organization because of its own read", async () => {
    fetchMock.mockImplementation(async () =>
      json({ id: "w1", name: "W", slug: "w", members: [], invitations: [] }),
    );
    const { useActiveOrganizationQuery } = await import("./store");

    const { result } = renderHook(() => useActiveOrganizationQuery());
    await waitFor(() => expect(result.current.data?.id).toBe("w1"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(callsTo("/organization/get-full-organization")).toBe(1);
  });

  it("returns null for a signed-out session and refetches after sign-in", async () => {
    let signedIn = false;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/sign-in/email")) {
        signedIn = true;
        return json({ token: "t", user: { id: "u1" } });
      }
      return json(
        signedIn ? { session: { id: "s1" }, user: { id: "u1" } } : null,
      );
    });
    const { useSessionQuery } = await import("./store");
    const { authRequest } = await import("./request");

    const { result } = renderHook(() => useSessionQuery());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();

    await authRequest("/sign-in/email", { method: "POST", body: {} });

    await waitFor(() => expect(result.current.data?.user.id).toBe("u1"));
  });

  it("treats a 401 session read as signed out", async () => {
    fetchMock.mockResolvedValue(json({ code: "UNAUTHORIZED" }, 401));
    const { useSessionQuery } = await import("./store");

    const { result } = renderHook(() => useSessionQuery());

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
