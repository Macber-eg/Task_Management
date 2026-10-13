import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { loadProjectTimeData } from "../load-project-time-data";
import {
  effectiveTaskEstimateMinutes,
  actualSecondsForTaskTree,
  summarizeEffort,
  sumEffortForTaskIds,
} from "../metrics";

function taskIdsInScope(
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

async function getProjectTimeReport(
  projectId: string,
  scope?: { phaseId?: string; sprintId?: string },
) {
  const data = await loadProjectTimeData(projectId);
  if (!data) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  const scopedTaskIds = taskIdsInScope(
    data.tasks,
    scope?.phaseId,
    scope?.sprintId,
  );
  const totals = sumEffortForTaskIds(
    scopedTaskIds,
    data.estimatedByTaskId,
    data.actualByTaskId,
    data.subtasksByParentId,
  );
  const summary = summarizeEffort(
    totals.estimatedMinutes,
    totals.actualSeconds,
  );

  const columns = await db
    .select({ slug: columnTable.slug, isFinal: columnTable.isFinal })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId));
  const finalStatuses = new Set(
    columns.filter((column) => column.isFinal).map((column) => column.slug),
  );

  const tasksDetail = scopedTaskIds
    .map((taskId) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task) return null;
      const estimatedMinutes = effectiveTaskEstimateMinutes(
        taskId,
        data.estimatedByTaskId,
        data.subtasksByParentId,
      );
      const actualSeconds = actualSecondsForTaskTree(
        taskId,
        data.actualByTaskId,
        data.subtasksByParentId,
      );
      const effort = summarizeEffort(estimatedMinutes, actualSeconds);
      return {
        taskId,
        title: task.title,
        number: task.number,
        status: task.status,
        phaseId: task.phaseId,
        sprintId: task.sprintId,
        completed: finalStatuses.has(task.status),
        ...effort,
      };
    })
    .filter(Boolean);

  const completedTasks = tasksDetail.filter((task) => task!.completed).length;

  const phases = data.phases
    .filter((phase) => (phase.kind ?? "folder") !== "document")
    .map((phase) => {
      const ids = taskIdsInScope(data.tasks, phase.id);
      const phaseTotals = sumEffortForTaskIds(
        ids,
        data.estimatedByTaskId,
        data.actualByTaskId,
        data.subtasksByParentId,
      );
      return {
        phaseId: phase.id,
        name: phase.name,
        ...summarizeEffort(
          phaseTotals.estimatedMinutes,
          phaseTotals.actualSeconds,
        ),
        taskCount: ids.length,
      };
    });

  const sprints = data.sprints.map((sprint) => {
    const ids = taskIdsInScope(data.tasks, undefined, sprint.id);
    const sprintTotals = sumEffortForTaskIds(
      ids,
      data.estimatedByTaskId,
      data.actualByTaskId,
      data.subtasksByParentId,
    );
    return {
      sprintId: sprint.id,
      name: sprint.name,
      phaseId: sprint.phaseId,
      ...summarizeEffort(
        sprintTotals.estimatedMinutes,
        sprintTotals.actualSeconds,
      ),
      taskCount: ids.length,
    };
  });

  return {
    projectId: data.project.id,
    projectName: data.project.name,
    ...summary,
    taskCount: scopedTaskIds.length,
    completedTasks,
    inProgressTasks: Math.max(0, scopedTaskIds.length - completedTasks),
    tasksOverEstimate: tasksDetail.filter((task) => task!.overEstimate).length,
    tasksMissingEstimate: tasksDetail.filter(
      (task) => (task!.estimatedMinutes ?? 0) === 0,
    ).length,
    tasksWithoutTime: tasksDetail.filter((task) => task!.actualSeconds === 0)
      .length,
    phases,
    sprints,
    tasks: tasksDetail,
  };
}

export default getProjectTimeReport;
