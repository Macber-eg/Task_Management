/** Ids of the tasks in a phase and/or sprint; every task when neither is set. */
export function taskIdsInScope(
  tasks: Array<{ id: string; phaseId: string | null; sprintId: string | null }>,
  phaseId?: string,
  sprintId?: string,
) {
  return tasks
    .filter((task) => {
      if (sprintId && task.sprintId !== sprintId) return false;
      if (phaseId && task.phaseId !== phaseId) return false;
      return true;
    })
    .map((task) => task.id);
}
