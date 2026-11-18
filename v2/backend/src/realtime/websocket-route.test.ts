import { expect, it } from "vitest";
import { parseWebSocketRoute } from "./websocket-route";

it("matches the user socket before the project parameter", () => {
  expect(parseWebSocketRoute("/api/ws/user")).toEqual({ kind: "user" });
  expect(parseWebSocketRoute("/api/ws/user?windowId=w")).toEqual({
    kind: "user",
  });
});

it("reads the project and the window that opened it", () => {
  expect(parseWebSocketRoute("/api/ws/p%201?windowId=w")).toEqual({
    kind: "project",
    projectId: "p 1",
    windowId: "w",
  });
  expect(parseWebSocketRoute("/api/ws/p")).toEqual({
    kind: "project",
    projectId: "p",
    windowId: null,
  });
});

it.each(["/api/ws", "/api/ws/", "/api/ws/a/b", "/api/other", "/ws/p"])(
  "does not serve %s",
  (path) => {
    expect(parseWebSocketRoute(path)).toBeNull();
  },
);
