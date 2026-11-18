import { Body, Controller, Req, UploadedFile } from "@nestjs/common";
import type { Request } from "express";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { UserId } from "../../auth/current-user.decorator";
import { validationError } from "../../common/errors/validation-error";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { apiBaseUrl } from "../upload/api-base-url";
import { DraftUploadService } from "./draft-upload.service";
import { MultipartFileUpload } from "../upload/multipart-file-upload.decorator";
import { TaskImageUploadService } from "./task-image-upload.service";
import {
  createTaskImageUploadRoute,
  stageTaskAssetUploadRoute,
} from "./task-upload.routes";
import { requireUploadEntitlement } from "../upload/upload-entitlement.handler";
import { taskImageUploadFields } from "../upload/upload-schemas";
import { type ReceivedFile, validateTaskUpload } from "../upload/validate-upload";

// The rest of `/task` lives in the task module; these routes need storage.
@Controller("task")
export class TaskUploadController {
  constructor(
    private readonly images: TaskImageUploadService,
    private readonly drafts: DraftUploadService,
  ) {}

  @ApiRoute(createTaskImageUploadRoute)
  @Access(
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireUploadEntitlement(),
  )
  @MultipartFileUpload()
  async uploadTaskImage(
    @Input() input: RouteInput<typeof createTaskImageUploadRoute>,
    @UploadedFile() file: ReceivedFile | undefined,
    @Body() fields: unknown,
    @UserId() userId: string,
    @Req() request: Request,
  ) {
    const parsed = taskImageUploadFields.safeParse(fields ?? {});
    if (!parsed.success) throw validationError(parsed.error.issues, "form");
    const upload = await validateTaskUpload(file);
    const asset = await this.images.upload(
      input.param.id,
      userId,
      parsed.data.surface,
      upload,
    );
    return { id: asset.id, url: `${apiBaseUrl(request)}/asset/${asset.id}` };
  }

  @ApiRoute(stageTaskAssetUploadRoute)
  @Access(
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireUploadEntitlement(),
  )
  @MultipartFileUpload()
  async stageTaskAssetUpload(
    @Input() input: RouteInput<typeof stageTaskAssetUploadRoute>,
    @UploadedFile() file: ReceivedFile | undefined,
    @UserId() userId: string,
    @Req() request: Request,
  ) {
    const upload = await validateTaskUpload(file);
    const asset = await this.drafts.stage(input.param.projectId, userId, upload);
    return { id: asset.id, url: `${apiBaseUrl(request)}/asset/${asset.id}` };
  }
}
