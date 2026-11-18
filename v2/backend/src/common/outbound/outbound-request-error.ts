type Failure = "timeout" | "http" | "network" | "response" | "destination";

// Never attach the original error/cause: it can include credential-bearing
// URLs, authorization headers or untrusted response bodies.
export class OutboundRequestError extends Error {
  constructor(
    readonly reason: Failure,
    readonly status?: number,
  ) {
    super(
      `Outbound request failed: ${reason}${status ? ` (HTTP ${status})` : ""}`,
    );
  }
}

export function safeOutboundError(error: unknown): string {
  return error instanceof OutboundRequestError
    ? error.message
    : "Outbound request failed";
}
