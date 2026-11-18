import type { RequestWithRawBody } from "../../common/http/json-body-parser";

/**
 * The bytes the provider signed. The JSON body parser keeps them for JSON
 * requests; any other content type is still unread, so it is read here.
 */
export async function readRawBody(request: RequestWithRawBody): Promise<Buffer> {
  if (request.rawBody) return request.rawBody;
  if (request.readableEnded) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
