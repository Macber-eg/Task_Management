import { Module } from "@nestjs/common";
import { PhaseService } from "./phase.service";
import { PhaseReorderService } from "./phase-reorder.service";
import { PlanningController } from "./planning.controller";
import { SprintService } from "./sprint.service";
import { SprintReorderService } from "./sprint-reorder.service";

@Module({
  controllers: [PlanningController],
  providers: [
    PhaseService,
    PhaseReorderService,
    SprintService,
    SprintReorderService,
  ],
})
export class PlanningModule {}
