import { Controller, Logger, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../auth/public.decorator";
import { HTTPException } from "../../common/errors/http-exception";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import {
  baseContentType,
  isImageContentType,
} from "../object-store/image-content-types";
import { ObjectStore, type StoredObject } from "../object-store/object-store";
import { AssetAccessService, isPublicAsset } from "./asset-access.service";
import { getAssetRoute } from "./asset.routes";
import { contentDisposition } from "./content-disposition";
import { streamObject } from "./stream-object";

@Controller("asset")
export class AssetController {
  private readonly logger = new Logger(AssetController.name);

  constructor(
    private readonly access: AssetAccessService,
    private readonly store: ObjectStore,
  ) {}

  // Public so anonymous readers of public projects get through the global
  // guard; `authorize` resolves and checks everyone else.
  @Public()
  @ApiRoute(getAssetRoute)
  async getAsset(
    @Input() input: RouteInput<typeof getAssetRoute>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.access.findAsset(input.param.id);
    if (!asset) throw new HTTPException(404, { message: "Asset not found" });

    await this.access.authorize(request, asset);

    let object: StoredObject;
    try {
      object = await this.store.get(asset.objectKey);
    } catch (error) {
      this.logger.error(
        `Failed to stream asset (${error instanceof Error ? error.name : "unknown error"})`,
      );
      throw new HTTPException(404, { message: "Asset object not found" });
    }

    const storedContentType = baseContentType(
      object.contentType || asset.mimeType,
    );
    const inline = isImageContentType(storedContentType);

    response.status(200).set({
      "Cache-Control": isPublicAsset(asset)
        ? "public, max-age=300"
        : "private, max-age=120",
      "Content-Disposition": contentDisposition(asset.filename, inline),
      "Content-Type": inline ? storedContentType : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (object.contentLength !== undefined)
      response.set("Content-Length", object.contentLength.toString());
    if (object.etag) response.set("ETag", object.etag);
    if (object.lastModified)
      response.set("Last-Modified", object.lastModified.toUTCString());

    await streamObject(response, object, this.logger);
  }
}
