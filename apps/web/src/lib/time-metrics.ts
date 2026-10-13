export type EffortSummary = {
  estimatedMinutes: number;
  actualSeconds: number;
  varianceMinutes: number;
  utilizationPercent: number | null;
  remainingMinutes: number;
  overEstimate: boolean;
};

export function minutesFromHoursAndMinutes(
  hours: number,
  minutes: number,
): number {
  const h = Math.max(0, Math.floor(hours) || 0);
  const m = Math.max(0, Math.min(59, Math.floor(minutes) || 0));
  return h * 60 + m;
}

export function summarizeEffort(
  estimatedMinutes: number | null | undefined,
  actualSeconds: number,
): EffortSummary {
  const estimate = Math.max(0, estimatedMinutes ?? 0);
  const actualMinutes = Math.max(0, actualSeconds) / 60;
  const varianceMinutes = actualMinutes - estimate;
  const utilizationPercent =
    estimate > 0 ? (actualMinutes / estimate) * 100 : null;
  const remainingMinutes = Math.max(estimate - actualMinutes, 0);
  return {
    estimatedMinutes: estimate,
    actualSeconds: Math.max(0, actualSeconds),
    varianceMinutes,
    utilizationPercent,
    remainingMinutes,
    overEstimate: estimate > 0 && actualMinutes > estimate,
  };
}

export function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatSecondsAsHours(seconds: number): string {
  return formatMinutesAsHours(seconds / 60);
}
