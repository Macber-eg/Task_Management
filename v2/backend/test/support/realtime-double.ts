import { vi } from "vitest";
import type { RealtimeConnections } from "../../src/realtime/realtime-connections";

/** Records what the application asks of the WebSocket layer. */
export function realtimeDouble() {
  return {
    revokeUserConnections: vi.fn<RealtimeConnections["revokeUserConnections"]>(),
    revokeWorkspaceConnections:
      vi.fn<RealtimeConnections["revokeWorkspaceConnections"]>(),
    closeProjectConnections:
      vi.fn<RealtimeConnections["closeProjectConnections"]>(),
    revokeSessionConnections:
      vi.fn<RealtimeConnections["revokeSessionConnections"]>(),
  } satisfies RealtimeConnections;
}

export type RealtimeDouble = ReturnType<typeof realtimeDouble>;

export function resetRealtimeDouble(double: RealtimeDouble): void {
  for (const mock of Object.values(double)) {
    mock.mockReset().mockResolvedValue(undefined);
  }
}
