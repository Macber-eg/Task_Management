import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { ProjectAccessService } from "../../access/project-access.service";
import { WorkspaceMembershipService } from "../../access/workspace-membership.service";
import { Authenticator } from "../../auth/authenticator";
import type { Principal } from "../../auth/principal";
import { HTTPException } from "../../common/errors/http-exception";

export type DownloadableAsset = {
  id: string;
  objectKey: string;
  mimeType: string;
  filename: string;
  surface: string;
  createdBy: string | null;
  workspaceId: string;
  projectId: string;
  isPublic: boolean | null;
};

/** Only description assets belong to the public project representation. */
export function isPublicAsset(asset: DownloadableAsset): boolean {
  return asset.isPublic === true && asset.surface === "description";
}

/**
 * Decides who may download an asset. The route is public so anonymous
 * readers of public projects get through the global guard; everyone else is
 * resolved here from a cookie, Bearer token or API key.
 */
@Injectable()
export class AssetAccessService {
  private readonly logger = new Logger(AssetAccessService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authenticator: Authenticator,
    private readonly membership: WorkspaceMembershipService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async findAsset(id: string): Promise<DownloadableAsset | null> {
    const [asset] = (await this.dataSource.query(
      `SELECT a.id, a.object_key AS "objectKey", a.mime_type AS "mimeType",
              a.filename, a.surface, a.created_by AS "createdBy",
              a.workspace_id AS "workspaceId", a.project_id AS "projectId",
              p.is_public AS "isPublic"
       FROM asset AS a
       INNER JOIN project AS p ON a.project_id = p.id
       WHERE a.id = $1
       LIMIT 1`,
      [id],
    )) as DownloadableAsset[];
    return asset ?? null;
  }

  async authorize(request: Request, asset: DownloadableAsset): Promise<void> {
    if (isPublicAsset(asset)) return;

    const principal = await this.resolveCaller(request);
    await this.membership.validateWorkspaceAccess(
      principal.userId,
      asset.workspaceId,
      principal.apiKey?.id,
      { notFoundMessage: "Asset not found" },
    );
    if (asset.surface.startsWith("draft") && asset.createdBy !== principal.userId)
      throw new HTTPException(403, {
        message: "Staged uploads are private to their owner",
      });
    await this.projectAccess.assertProjectAccess(
      principal.userId,
      asset.projectId,
    );
  }

  private async resolveCaller(request: Request): Promise<Principal> {
    let principal: Principal | null;
    try {
      principal = await this.authenticator.authenticate(request);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      this.logger.error("Asset authentication failed", error);
      throw new HTTPException(500, { message: "Internal Server Error" });
    }
    if (!principal) throw new HTTPException(401, { message: "Unauthorized" });
    return principal;
  }
}
