/** Skip webhook sync when it likely echoes our own outbound API update. */
export const OUTBOUND_STATE_ECHO_WINDOW_MS = 5000;

export function parseIssueUpdatedAtMs(issue: {
  updated_at?: string;
}): number | null {
  const raw = issue.updated_at;
  if (!raw || typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Whether a state webhook reports the state Kaneo itself last wrote, within
 * the echo window of that write.
 */
export function isOutboundStateEcho(
  metadata: Record<string, unknown>,
  state: string,
  issue: { updated_at?: string },
): boolean {
  const lastOutbound = metadata.lastOutboundStateSyncAt;
  if (
    typeof lastOutbound !== "number" ||
    !Number.isFinite(lastOutbound) ||
    metadata.state !== state
  )
    return false;
  const eventMs = parseIssueUpdatedAtMs(issue);
  return (
    eventMs !== null &&
    Math.abs(eventMs - lastOutbound) <= OUTBOUND_STATE_ECHO_WINDOW_MS
  );
}
