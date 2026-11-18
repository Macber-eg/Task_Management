export type GiteaApiErrorKind =
  | "REDIRECT"
  | "INVALID_JSON"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE";

export class GiteaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: GiteaApiErrorKind,
    public body?: string,
  ) {
    super(message);
    this.name = "GiteaApiError";
  }
}

export function emptyGiteaResponse(what: string): GiteaApiError {
  return new GiteaApiError(
    `Gitea ${what} response was empty`,
    500,
    "EMPTY_RESPONSE",
  );
}
