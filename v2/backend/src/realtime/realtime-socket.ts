/** What the realtime layer needs from an open WebSocket. */
export type RealtimeSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type ProjectConnection = {
  socket: RealtimeSocket;
  userId: string;
  /** `userId:windowId`, so the tab that made a change skips its echo. */
  initiatorId: string;
  workspaceId: string;
  /** The login session the socket was opened with; null for API keys. */
  sessionId: string | null;
};

export type UserConnection = {
  socket: RealtimeSocket;
  sessionId: string | null;
};
