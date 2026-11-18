/**
 * Magic-link URLs carry their callback URLs encoded once more than the query
 * string requires; a value that does not decode is used as it is.
 */
export function decodeUrlParameter(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
