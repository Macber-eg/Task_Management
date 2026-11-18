import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";

/** Answers a refused handshake with a bodyless HTTP error, then drops the socket. */
export function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy(),
  );
}
