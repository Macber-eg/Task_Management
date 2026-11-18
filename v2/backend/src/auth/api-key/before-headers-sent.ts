import type {
  OutgoingHttpHeader,
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";

type WriteHeadHeaders = OutgoingHttpHeaders | OutgoingHttpHeader[];

function adoptHeaders(response: ServerResponse, headers: WriteHeadHeaders) {
  if (!Array.isArray(headers)) {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) response.setHeader(name, value);
    }
    return;
  }
  // The raw form is a flat [name, value, name, value] list that replaces
  // earlier headers of the same name but may repeat a name itself.
  for (let i = 0; i < headers.length; i += 2) {
    response.removeHeader(String(headers[i]));
  }
  for (let i = 0; i + 1 < headers.length; i += 2) {
    response.appendHeader(String(headers[i]), headers[i + 1] as string);
  }
}

/**
 * Runs `listener` just before the response head is written, when every
 * header the handler, a filter or other middleware set is final. Headers
 * handed to `writeHead` itself are applied first so the listener sees, and
 * can still change, all of them.
 */
export function beforeHeadersSent(
  response: ServerResponse,
  listener: () => void,
): void {
  const writeHead = response.writeHead as (
    this: ServerResponse,
    statusCode: number,
    reason?: string,
  ) => ServerResponse;

  response.writeHead = function (
    this: ServerResponse,
    statusCode: number,
    ...rest: [(string | WriteHeadHeaders)?, WriteHeadHeaders?]
  ) {
    const reason = typeof rest[0] === "string" ? rest[0] : undefined;
    const headers = typeof rest[0] === "string" ? rest[1] : rest[0];

    if (headers) adoptHeaders(this, headers);
    listener();

    return reason === undefined
      ? writeHead.call(this, statusCode)
      : writeHead.call(this, statusCode, reason);
  } as ServerResponse["writeHead"];
}
