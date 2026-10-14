import { resolveApiBaseUrl } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type InstanceStatus = {
  hasUsers: boolean;
  hasAdmin: boolean;
};

export async function getInstanceStatus(): Promise<InstanceStatus> {
  const baseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
  const requestUrl = `${baseUrl}/instance/status`;
  // #region agent log
  fetch("http://127.0.0.1:7804/ingest/61d405ff-4b89-4235-9930-67a85d749db2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "3bc299",
    },
    body: JSON.stringify({
      sessionId: "3bc299",
      location: "get-instance-status.ts:pre-fetch",
      message: "instance status fetch start",
      data: {
        requestUrl,
        viteApiUrl: import.meta.env.VITE_API_URL ?? null,
        pageOrigin:
          typeof window !== "undefined" ? window.location.origin : null,
      },
      timestamp: Date.now(),
      hypothesisId: "H1-CORS-origin",
    }),
  }).catch(() => {});
  // #endregion
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      credentials: "include",
    });
  } catch (err) {
    // #region agent log
    fetch("http://127.0.0.1:7804/ingest/61d405ff-4b89-4235-9930-67a85d749db2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "3bc299",
      },
      body: JSON.stringify({
        sessionId: "3bc299",
        location: "get-instance-status.ts:fetch-catch",
        message: "instance status fetch failed",
        data: {
          requestUrl,
          pageOrigin:
            typeof window !== "undefined" ? window.location.origin : null,
          error: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
        hypothesisId: "H1-CORS-origin",
      }),
    }).catch(() => {});
    // #endregion
    throw err;
  }
  if (!response.ok) {
    // Surface the server's error body when available so the UI can
    // distinguish "instance unreachable" from other failures.
    const error = await HttpError.fromResponse(response);
    throw new HttpError(
      response.status,
      `Failed to fetch instance status: ${error.message}`,
      error,
    );
  }
  return response.json();
}
