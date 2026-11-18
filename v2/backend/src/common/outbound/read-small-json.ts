import { OutboundRequestError } from "./outbound-request-error";

const MAX_JSON_BYTES = 16_384;

/** Reads a response body as JSON, refusing anything over 16 KiB. */
export async function readSmallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new OutboundRequestError("response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) throw new OutboundRequestError("response");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OutboundRequestError("response");
    }
  } finally {
    // Cancellation need not wait for the remote peer to close its stream.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
