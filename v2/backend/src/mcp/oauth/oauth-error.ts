import { HTTPException } from "../../common/errors/http-exception";

/**
 * OAuth clients parse the RFC 6749 / RFC 7591 `{ error, error_description }`
 * shape, so these failures carry their own body instead of the API's.
 */
export function oauthError(
  status: number,
  error: string,
  options: { description?: string; headers?: Record<string, string> } = {},
): HTTPException {
  const body =
    options.description === undefined
      ? { error }
      : { error, error_description: options.description };
  return new HTTPException(status, {
    res: Response.json(body, { status, headers: options.headers }),
  });
}
