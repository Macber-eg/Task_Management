import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyGiteaAccess } from "./verify-gitea-access";

// Ported from tests/api/gitea-integration/verify-gitea-access-fetch.test.ts,
// plus the kind-dispatch cases of verify-gitea-access.test.ts, against a
// stubbed fetch instead of a mocked API module.
function makeResponse(status: number, body: string | object = ""): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const input = {
  baseUrl: "https://gitea.example",
  accessToken: "token",
  repositoryOwner: "owner",
  repositoryName: "repo",
};

const user = () => makeResponse(200, { id: 1, login: "owner" });

beforeEach(() => {
  // The DNS check would otherwise resolve gitea.example.
  vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verifyGiteaAccess", () => {
  it("returns success when the API returns a user and a writable repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(user())
        .mockResolvedValueOnce(
          makeResponse(200, {
            name: "repo",
            owner: { login: "owner" },
            html_url: "https://gitea.example/owner/repo",
            private: false,
            permissions: { admin: true, push: true, pull: true },
          }),
        ),
    );

    expect(await verifyGiteaAccess(input)).toEqual({
      isInstalled: true,
      hasRequiredPermissions: true,
      repositoryExists: true,
      repositoryPrivate: false,
      missingPermissions: [],
      message: "Token can access the repository.",
      failureReason: null,
    });
  });

  it("reports missing issue permissions for a read-only token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(user())
        .mockResolvedValueOnce(
          makeResponse(200, {
            name: "repo",
            owner: { login: "owner" },
            html_url: "https://gitea.example/owner/repo",
            private: true,
            permissions: { admin: false, push: false, pull: true },
          }),
        ),
    );

    expect(await verifyGiteaAccess(input)).toMatchObject({
      hasRequiredPermissions: false,
      repositoryPrivate: true,
      missingPermissions: ["issues (write)"],
      message: "Token may not have sufficient permissions to manage issues.",
    });
  });

  it("returns the 'not a Gitea instance' message when the response body is HTML, not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(200, "<html>Not Gitea</html>")),
    );

    const result = await verifyGiteaAccess(input);
    expect(result.isInstalled).toBe(false);
    expect(result.repositoryExists).toBe(false);
    expect(result.failureReason).toBe("not_a_gitea_instance");
    expect(result.message).toBe("The URL does not point to a Gitea instance.");
  });

  it.each([308, 301])(
    "returns a redirect-specific message when the API responds with %s",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(status)));

      const result = await verifyGiteaAccess({
        ...input,
        baseUrl: "http://gitea.example",
      });
      expect(result.isInstalled).toBe(false);
      expect(result.failureReason).toBe("redirected");
      expect(result.message).toContain("redirected");
      expect(result.message).toContain(`HTTP ${status}`);
      expect(result.message).not.toContain(
        "does not point to a Gitea instance.",
      );
    },
  );

  it("returns a redirect-specific message when getRepo redirects after the token check succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(user()).mockResolvedValueOnce(makeResponse(301)),
    );

    const result = await verifyGiteaAccess(input);
    expect(result.failureReason).toBe("redirected");
    expect(result.message).toContain("HTTP 301");
  });

  it("returns the repository-not-found message when getRepo responds with 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(user())
        .mockResolvedValueOnce(makeResponse(404, "Not Found")),
    );

    const result = await verifyGiteaAccess(input);
    expect(result.isInstalled).toBe(false);
    expect(result.failureReason).toBe("repository_not_found");
    expect(result.message).toBe(
      "Repository not found or not accessible with this token.",
    );
  });

  it("returns the not-a-gitea-instance message when /user responds with 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(404, "Not Found")),
    );

    const result = await verifyGiteaAccess(input);
    expect(result.isInstalled).toBe(false);
    expect(result.failureReason).toBe("not_a_gitea_instance");
    expect(result.message).toBe("The URL does not point to a Gitea instance.");
  });

  it("answers 400 for a token Gitea rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeResponse(401, "Unauthorized")),
    );

    await expect(verifyGiteaAccess(input)).rejects.toMatchObject({
      status: 400,
      message: "Invalid Gitea token or unauthorized.",
    });
  });
});
