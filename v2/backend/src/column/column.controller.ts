import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createColumnRoute,
  deleteColumnRoute,
  getColumnsRoute,
  reorderColumnsRoute,
  updateColumnRoute,
} from "./column.routes";
import { ColumnCreationService } from "./column-creation.service";
import { ColumnDeletionService } from "./column-deletion.service";
import { ColumnQueryService } from "./column-query.service";
import { ColumnReorderService } from "./column-reorder.service";
import { ColumnUpdateService } from "./column-update.service";

// `PUT /reorder/:projectId` is declared before `PUT /:id`, as before.
@Controller("column")
export class ColumnController {
  constructor(
    private readonly query: ColumnQueryService,
    private readonly creation: ColumnCreationService,
    private readonly reorder: ColumnReorderService,
    private readonly update: ColumnUpdateService,
    private readonly deletion: ColumnDeletionService,
  ) {}

  @ApiRoute(getColumnsRoute)
  @Access(workspaceAccess.fromProject("projectId"))
  getColumns(@Input() input: RouteInput<typeof getColumnsRoute>) {
    return this.query.getColumns(input.param.projectId);
  }

  @ApiRoute(createColumnRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  createColumn(@Input() input: RouteInput<typeof createColumnRoute>) {
    const { name, icon, color, isFinal } = input.json;
    return this.creation.createColumn({
      projectId: input.param.projectId,
      name,
      icon,
      color,
      isFinal,
    });
  }

  @ApiRoute(reorderColumnsRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  reorderColumns(@Input() input: RouteInput<typeof reorderColumnsRoute>) {
    return this.reorder.reorderColumns(
      input.param.projectId,
      input.json.columns,
    );
  }

  @ApiRoute(updateColumnRoute)
  @Access(
    workspaceAccess.fromColumn("id"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  updateColumn(@Input() input: RouteInput<typeof updateColumnRoute>) {
    return this.update.updateColumn(input.param.id, input.json);
  }

  @ApiRoute(deleteColumnRoute)
  @Access(
    workspaceAccess.fromColumn("id"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  deleteColumn(@Input() input: RouteInput<typeof deleteColumnRoute>) {
    return this.deletion.deleteColumn(input.param.id);
  }
}
