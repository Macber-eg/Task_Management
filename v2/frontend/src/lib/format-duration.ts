export function formatMinutesSeconds(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatClockDuration(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function elapsedSecondsSince(isoStart: string) {
  const startMs = new Date(isoStart).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}
