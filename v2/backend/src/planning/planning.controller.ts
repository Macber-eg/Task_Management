import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import { PhaseService } from "./phase.service";
import { PhaseReorderService } from "./phase-reorder.service";
import {
  createPhaseRoute,
  createSprintRoute,
  deletePhaseRoute,
  deleteSprintRoute,
  getPhasesRoute,
  getSprintsRoute,
  reorderPhasesRoute,
  reorderSprintsRoute,
  updatePhaseRoute,
  updateSprintRoute,
} from "./planning.routes";
import { SprintService } from "./sprint.service";
import { SprintReorderService } from "./sprint-reorder.service";

const canUpdateProject = requireWorkspacePermission({ project: ["update"] });

@Controller("planning")
export class PlanningController {
  constructor(
    private readonly phases: PhaseService,
    private readonly phaseReorder: PhaseReorderService,
    private readonly sprints: SprintService,
    private readonly sprintReorder: SprintReorderService,
  ) {}

  @ApiRoute(getPhasesRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  getPhases(@Input() input: RouteInput<typeof getPhasesRoute>) {
    return this.phases.getPhases(input.param.projectId);
  }

  @ApiRoute(createPhaseRoute)
  @Access(workspaceAccess.fromProject("projectId"), canUpdateProject)
  createPhase(@Input() input: RouteInput<typeof createPhaseRoute>) {
    return this.phases.createPhase({
      projectId: input.param.projectId,
      ...input.json,
    });
  }

  @ApiRoute(updatePhaseRoute)
  @Access(workspaceAccess.fromProjectPhase("id"), canUpdateProject)
  updatePhase(@Input() input: RouteInput<typeof updatePhaseRoute>) {
    return this.phases.updatePhase(input.param.id, input.json);
  }

  @ApiRoute(deletePhaseRoute)
  @Access(workspaceAccess.fromProjectPhase("id"), canUpdateProject)
  deletePhase(@Input() input: RouteInput<typeof deletePhaseRoute>) {
    return this.phases.deletePhase(input.param.id);
  }

  @ApiRoute(reorderPhasesRoute)
  @Access(workspaceAccess.fromProject("projectId"), canUpdateProject)
  reorderPhases(@Input() input: RouteInput<typeof reorderPhasesRoute>) {
    return this.phaseReorder.reorderPhases(
      input.param.projectId,
      input.json.phases,
    );
  }

  @ApiRoute(getSprintsRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  getSprints(@Input() input: RouteInput<typeof getSprintsRoute>) {
    return this.sprints.getSprints(input.param.projectId);
  }

  @ApiRoute(createSprintRoute)
  @Access(workspaceAccess.fromProject("projectId"), canUpdateProject)
  createSprint(@Input() input: RouteInput<typeof createSprintRoute>) {
    return this.sprints.createSprint({
      projectId: input.param.projectId,
      ...input.json,
    });
  }

  @ApiRoute(updateSprintRoute)
  @Access(workspaceAccess.fromProjectSprint("id"), canUpdateProject)
  updateSprint(@Input() input: RouteInput<typeof updateSprintRoute>) {
    return this.sprints.updateSprint(input.param.id, input.json);
  }

  @ApiRoute(deleteSprintRoute)
  @Access(workspaceAccess.fromProjectSprint("id"), canUpdateProject)
  deleteSprint(@Input() input: RouteInput<typeof deleteSprintRoute>) {
    return this.sprints.deleteSprint(input.param.id);
  }

  @ApiRoute(reorderSprintsRoute)
  @Access(workspaceAccess.fromProject("projectId"), canUpdateProject)
  reorderSprints(@Input() input: RouteInput<typeof reorderSprintsRoute>) {
    return this.sprintReorder.reorderSprints(
      input.param.projectId,
      input.json.sprints,
    );
  }
}
