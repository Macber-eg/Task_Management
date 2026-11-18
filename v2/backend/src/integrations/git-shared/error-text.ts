/** An error's message for a log line; never the error object (it may carry request details). */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
