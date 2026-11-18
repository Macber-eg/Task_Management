export type EffortTotals = {
  estimatedMinutes: number;
  actualSeconds: number;
};

export type EffortSummary = EffortTotals & {
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

/** Parent tasks with subtasks use rolled-up subtask estimates instead of the parent field. */
export function effectiveTaskEstimateMinutes(
  taskId: string,
  estimatedByTaskId: Map<string, number | null | undefined>,
  subtasksByParentId: Map<string, string[]>,
): number {
  const subtasks = subtasksByParentId.get(taskId) ?? [];
  if (subtasks.length === 0) {
    return Math.max(0, estimatedByTaskId.get(taskId) ?? 0);
  }
  return subtasks.reduce(
    (sum, childId) => sum + Math.max(0, estimatedByTaskId.get(childId) ?? 0),
    0,
  );
}

export function actualSecondsForTaskTree(
  taskId: string,
  actualByTaskId: Map<string, number>,
  subtasksByParentId: Map<string, string[]>,
): number {
  let total = actualByTaskId.get(taskId) ?? 0;
  for (const childId of subtasksByParentId.get(taskId) ?? []) {
    total += actualSecondsForTaskTree(
      childId,
      actualByTaskId,
      subtasksByParentId,
    );
  }
  return total;
}

export function sumEffortForTaskIds(
  taskIds: string[],
  estimatedByTaskId: Map<string, number | null | undefined>,
  actualByTaskId: Map<string, number>,
  subtasksByParentId: Map<string, string[]>,
): EffortTotals {
  let estimatedMinutes = 0;
  let actualSeconds = 0;
  for (const taskId of taskIds) {
    estimatedMinutes += effectiveTaskEstimateMinutes(
      taskId,
      estimatedByTaskId,
      subtasksByParentId,
    );
    actualSeconds += actualSecondsForTaskTree(
      taskId,
      actualByTaskId,
      subtasksByParentId,
    );
  }
  return { estimatedMinutes, actualSeconds };
}
