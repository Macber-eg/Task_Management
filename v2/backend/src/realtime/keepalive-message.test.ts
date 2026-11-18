import { expect, it, vi } from "vitest";
import { handleKeepaliveMessage } from "./keepalive-message";

function socket() {
  return { send: vi.fn(), close: vi.fn() };
}

it("accepts the exact text keepalive", () => {
  const ws = socket();
  handleKeepaliveMessage(Buffer.from('{"type":"ping"}'), false, ws);
  expect(ws.close).not.toHaveBeenCalled();
});

it.each([
  ['{"type":"other"}', false, 1008, "Unsupported message"],
  ["{", false, 1008, "Unsupported message"],
  ['{"type":"ping"}', true, 1003, "Only text keepalives are supported"],
  ["a".repeat(65), false, 1009, "Message too large"],
] as const)("closes %s (binary=%s) with %i", (data, binary, code, reason) => {
  const ws = socket();
  handleKeepaliveMessage(Buffer.from(data), binary, ws);
  expect(ws.close).toHaveBeenCalledWith(code, reason);
});
