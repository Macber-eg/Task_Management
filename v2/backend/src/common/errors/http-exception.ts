type HTTPExceptionOptions = {
  message?: string;
  /** A prepared response whose status, headers and body should be sent. */
  res?: Response;
  cause?: unknown;
};

/**
 * The error every expected failure is thrown as; `AllExceptionsFilter` turns
 * it into the API error body. It keeps the constructor shape the previous API
 * used, so `throw new HTTPException(404, { message })` reads the same in
 * ported code. It is not a Nest `HttpException` because that class keeps
 * `status` private and ported code reads `error.status`.
 */
export class HTTPException extends Error {
  readonly status: number;
  readonly res?: Response;

  constructor(status: number, options: HTTPExceptionOptions = {}) {
    super(options.message ?? "", { cause: options.cause });
    this.name = "HTTPException";
    this.status = status;
    this.res = options.res;
  }
}
