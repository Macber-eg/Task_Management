import type { RawData } from "ws";
import type { RealtimeSocket } from "./realtime-socket";

/** Also the server's `maxPayload`, so larger frames never reach this code. */
export const MAX_WEBSOCKET_MESSAGE_BYTES = 64;

const KEEPALIVE = '{"type":"ping"}';

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/**
 * Clients only ever send this exact keepalive. No arbitrary JSON is parsed,
 * copied or dispatched; receiving it is enough to keep proxies alive.
 */
export function handleKeepaliveMessage(
  data: RawData,
  isBinary: boolean,
  socket: RealtimeSocket,
): void {
  if (isBinary) {
    socket.close(1003, "Only text keepalives are supported");
    return;
  }
  const bytes = toBuffer(data);
  if (bytes.byteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
    socket.close(1009, "Message too large");
    return;
  }
  if (bytes.toString("utf8") !== KEEPALIVE) {
    socket.close(1008, "Unsupported message");
  }
}
