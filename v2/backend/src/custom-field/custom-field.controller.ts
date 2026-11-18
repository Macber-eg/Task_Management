import { Controller } from "@nestjs/common";
import { Access } from "../access/access-rule";
import { requireWorkspacePermission } from "../access/require-workspace-permission";
import { workspaceAccess } from "../access/workspace-access";
import { ApiRoute, Input, type RouteInput } from "../common/openapi";
import {
  createCustomFieldRoute,
  deleteCustomFieldRoute,
  getCustomFieldFilterValuesRoute,
  getCustomFieldsRoute,
  getCustomFieldValuesByProjectRoute,
  getCustomFieldValuesByTaskRoute,
  reorderCustomFieldsRoute,
  setCustomFieldValueRoute,
} from "./custom-field.routes";
import { CustomFieldCreationService } from "./custom-field-creation.service";
import { CustomFieldDeletionService } from "./custom-field-deletion.service";
import { CustomFieldQueryService } from "./custom-field-query.service";
import { CustomFieldReorderService } from "./custom-field-reorder.service";
import { CustomFieldValueService } from "./custom-field-value.service";

@Controller("custom-field")
export class CustomFieldController {
  constructor(
    private readonly query: CustomFieldQueryService,
    private readonly creation: CustomFieldCreationService,
    private readonly reorder: CustomFieldReorderService,
    private readonly values: CustomFieldValueService,
    private readonly deletion: CustomFieldDeletionService,
  ) {}

  @ApiRoute(getCustomFieldsRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["read"] }),
  )
  getCustomFieldsByProject(
    @Input() input: RouteInput<typeof getCustomFieldsRoute>,
  ) {
    return this.query.getCustomFieldsByProject(input.param.projectId);
  }

  @ApiRoute(getCustomFieldValuesByProjectRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  )
  getCustomFieldValuesByProject(
    @Input() input: RouteInput<typeof getCustomFieldValuesByProjectRoute>,
  ) {
    return this.query.getCustomFieldValuesByProject(input.param.projectId);
  }

  @ApiRoute(getCustomFieldValuesByTaskRoute)
  @Access(
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["read"] }),
  )
  getCustomFieldValuesByTask(
    @Input() input: RouteInput<typeof getCustomFieldValuesByTaskRoute>,
  ) {
    return this.query.getCustomFieldValuesByTask(input.param.taskId);
  }

  @ApiRoute(getCustomFieldFilterValuesRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["read"] }),
  )
  getCustomFieldFilterValues(
    @Input() input: RouteInput<typeof getCustomFieldFilterValuesRoute>,
  ) {
    return this.query.getCustomFieldFilterValues(input.param.projectId);
  }

  @ApiRoute(createCustomFieldRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  createCustomField(@Input() input: RouteInput<typeof createCustomFieldRoute>) {
    const { projectId, ...definition } = input.json;
    return this.creation.createCustomField(projectId, definition);
  }

  @ApiRoute(reorderCustomFieldsRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  reorderCustomFields(
    @Input() input: RouteInput<typeof reorderCustomFieldsRoute>,
  ) {
    return this.reorder.reorderCustomFields(
      input.param.projectId,
      input.json.fields,
    );
  }

  @ApiRoute(setCustomFieldValueRoute)
  @Access(
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ task: ["update"] }),
  )
  setCustomFieldValue(
    @Input() input: RouteInput<typeof setCustomFieldValueRoute>,
  ) {
    const { taskId, fieldId, value } = input.json;
    return this.values.setCustomFieldValue(taskId, fieldId, value);
  }

  @ApiRoute(deleteCustomFieldRoute)
  @Access(
    workspaceAccess.fromCustomField("id"),
    requireWorkspacePermission({ project: ["update"] }),
  )
  deleteCustomField(@Input() input: RouteInput<typeof deleteCustomFieldRoute>) {
    return this.deletion.deleteCustomField(input.param.id);
  }
}
