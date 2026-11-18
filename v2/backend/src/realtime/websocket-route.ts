export type WebSocketRoute =
  | { kind: "user" }
  | { kind: "project"; projectId: string; windowId: string | null };

const PROJECT_PATH = /^\/api\/ws\/([^/]+)$/;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `/api/ws/user` or `/api/ws/:projectId?windowId=`; null for anything else. */
export function parseWebSocketRoute(requestUrl: string): WebSocketRoute | null {
  const url = new URL(requestUrl, "http://localhost");
  if (url.pathname === "/api/ws/user") return { kind: "user" };
  const match = PROJECT_PATH.exec(url.pathname);
  if (!match?.[1]) return null;
  return {
    kind: "project",
    projectId: decode(match[1]),
    windowId: url.searchParams.get("windowId"),
  };
}
