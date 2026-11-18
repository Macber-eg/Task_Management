import { Controller, Headers, Logger, Req, Res, UploadedFile } from "@nestjs/common";
import type { Request, Response } from "express";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { reply } from "../../common/http/reply";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import { streamObject } from "../asset/stream-object";
import { apiBaseUrl } from "../upload/api-base-url";
import { MultipartFileUpload } from "../upload/multipart-file-upload.decorator";
import {
  deleteProjectBackgroundRoute,
  getProjectBackgroundRoute,
  uploadProjectBackgroundRoute,
} from "./project-background.routes";
import { ProjectBackgroundService } from "./project-background.service";
import { ProjectBackgroundReader } from "./project-background-reader.service";
import { requireUploadEntitlement } from "../upload/upload-entitlement.handler";
import { type ReceivedFile, validateBackgroundUpload } from "../upload/validate-upload";

// The rest of `/project` lives in the project module; these routes need storage.
@Controller("project")
export class ProjectBackgroundController {
  private readonly logger = new Logger(ProjectBackgroundController.name);

  constructor(
    private readonly backgrounds: ProjectBackgroundService,
    private readonly reader: ProjectBackgroundReader,
  ) {}

  // Written to the response directly: the body is the stored image stream.
  @ApiRoute(getProjectBackgroundRoute)
  @Access(workspaceAccess.fromProject())
  async getProjectBackground(
    @Input() input: RouteInput<typeof getProjectBackgroundRoute>,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const { object, headers } = await this.reader.open(input.param.id);

    if (ifNoneMatch === headers.ETag) {
      object.body.destroy();
      response.status(304).set(headers).end();
      return;
    }
    response.status(200).set(headers);
    await streamObject(response, object, this.logger);
  }

  @ApiRoute(uploadProjectBackgroundRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
    requireUploadEntitlement(),
  )
  @MultipartFileUpload()
  async uploadProjectBackground(
    @Input() input: RouteInput<typeof uploadProjectBackgroundRoute>,
    @UploadedFile() file: ReceivedFile | undefined,
    @Req() request: Request,
  ) {
    const { id } = input.param;
    const upload = await validateBackgroundUpload(file);
    const version = await this.backgrounds.replace(id, upload);
    return {
      url: `${apiBaseUrl(request)}/project/${id}/background?v=${encodeURIComponent(version)}`,
    };
  }

  @ApiRoute(deleteProjectBackgroundRoute)
  @Access(
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  )
  async deleteProjectBackground(
    @Input() input: RouteInput<typeof deleteProjectBackgroundRoute>,
  ) {
    await this.backgrounds.remove(input.param.id);
    return reply(204, undefined);
  }
}
