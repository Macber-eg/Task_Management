/**
 * A handler result with an explicit status (and optional headers). Handlers
 * return plain values for 200 and `reply(202, body)` for anything else.
 */
export class Reply<T = unknown> {
  constructor(
    readonly status: number,
    readonly body: T,
    readonly headers: Record<string, string> = {},
  ) {}
}

export function reply<T>(
  status: number,
  body: T,
  headers?: Record<string, string>,
): Reply<T> {
  return new Reply(status, body, headers);
}
