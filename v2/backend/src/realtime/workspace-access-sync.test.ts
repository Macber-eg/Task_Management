import { expect, it, vi } from "vitest";
import { syncWorkspaceAccess } from "./workspace-access-sync";

function socket() {
  return { send: vi.fn(), close: vi.fn() };
}

it("sends current workspace access when reconnecting after an offline removal", async () => {
  const ws = socket();
  await syncWorkspaceAccess(
    { accessibleWorkspaceIds: async () => ["still-authorized"] },
    "user",
    ws,
  );
  expect(JSON.parse(ws.send.mock.calls[0]?.[0])).toEqual({
    type: "WORKSPACE_ACCESS_SYNC",
    workspaceIds: ["still-authorized"],
  });
});

it("closes the socket of a user who no longer exists", async () => {
  const ws = socket();
  await syncWorkspaceAccess({ accessibleWorkspaceIds: async () => null }, "user", ws);
  expect(ws.send).not.toHaveBeenCalled();
  expect(ws.close).toHaveBeenCalledWith(1008, "User access revoked");
});

it("requires a reconnect if access synchronization fails", async () => {
  const ws = socket();
  await syncWorkspaceAccess(
    {
      accessibleWorkspaceIds: async () => {
        throw new Error("database unavailable");
      },
    },
    "user",
    ws,
  );
  expect(ws.send).not.toHaveBeenCalled();
  expect(ws.close).toHaveBeenCalledWith(
    1011,
    "Workspace access synchronization failed",
  );
});
