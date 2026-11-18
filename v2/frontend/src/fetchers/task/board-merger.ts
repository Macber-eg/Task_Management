import type { ProjectWithTasks } from "@/types/project";

type BoardTask = ProjectWithTasks["plannedTasks"][number];

/**
 * Merges board pages into `result` in place. Tasks are deduplicated by id and
 * their labels and links are combined, so overlapping pages are safe.
 */
export function createBoardMerger<T extends ProjectWithTasks>(result: T) {
  const columns = new Map(result.columns.map((column) => [column.id, column]));
  const seen = new Map<string, BoardTask>(
    [
      ...result.columns.flatMap((column) => column.tasks),
      ...result.archivedTasks,
      ...result.plannedTasks,
    ].map((task) => [task.id, task]),
  );
  const state = {
    weight:
      result.columns.length +
      seen.size +
      [...seen.values()].reduce(
        (count, task) =>
          count +
          (task.labels?.length ?? 0) +
          (task.externalLinks?.length ?? 0),
        0,
      ),
  };
  const relationIndexes = new WeakMap<object[], Map<string, number>>();
  const mergeById = <U extends { id: string }>(
    left: U[] = [],
    right: U[] = [],
  ) => {
    let indexes = relationIndexes.get(left);
    if (!indexes) {
      indexes = new Map(left.map((value, index) => [value.id, index]));
      relationIndexes.set(left, indexes);
    }
    for (const value of right) {
      const index = indexes.get(value.id);
      if (index === undefined) {
        indexes.set(value.id, left.length);
        left.push(value);
        state.weight++;
      } else left[index] = value;
    }
    return left;
  };
  const append = (target: BoardTask[], tasks: BoardTask[]) => {
    for (const task of tasks) {
      const existing = seen.get(task.id);
      if (!existing) {
        seen.set(task.id, task);
        target.push(task);
        state.weight +=
          1 + (task.labels?.length ?? 0) + (task.externalLinks?.length ?? 0);
      } else {
        existing.labels = mergeById(existing.labels, task.labels);
        existing.externalLinks = mergeById(
          existing.externalLinks,
          task.externalLinks,
        );
      }
    }
  };
  const merge = (next: T) => {
    for (const column of next.columns) {
      let target = columns.get(column.id);
      if (!target) {
        target = { ...column, tasks: [] };
        columns.set(column.id, target);
        result.columns.push(target);
        state.weight++;
      }
      append(target.tasks, column.tasks);
    }
    append(result.archivedTasks, next.archivedTasks);
    append(result.plannedTasks, next.plannedTasks);
  };
  return {
    merge,
    get weight() {
      return state.weight;
    },
  };
}
