import { Controller } from "@nestjs/common";
import { Access } from "../../access/access-rule";
import { requireWorkspacePermission } from "../../access/require-workspace-permission";
import { workspaceAccess } from "../../access/workspace-access";
import { ResolvedWorkspaceId } from "../../project/resolved-workspace-id.decorator";
import { ApiRoute, Input, type RouteInput } from "../../common/openapi";
import {
  getSyncRulesRoute,
  previewSyncRulesRoute,
  resumeSyncRoute,
  reviewSyncResumeRoute,
  saveSyncRulesRoute,
} from "./integration-sync.routes";
import { SyncResumeReviewService } from "./sync-resume-review.service";
import { SyncResumeService } from "./sync-resume.service";
import { SyncRulesService } from "./sync-rules.service";

const read = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["read"], task: ["read"] }),
];
const manage = [
  ...read,
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
];

@Controller("integration-sync")
export class IntegrationSyncController {
  constructor(
    private readonly rules: SyncRulesService,
    private readonly reviews: SyncResumeReviewService,
    private readonly resumes: SyncResumeService,
  ) {}

  @ApiRoute(getSyncRulesRoute)
  @Access(...read)
  getRules(
    @Input() input: RouteInput<typeof getSyncRulesRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { projectId, provider } = input.param;
    return this.rules.getRules(
      projectId,
      provider,
      workspaceId,
      input.query.after,
    );
  }

  @ApiRoute(previewSyncRulesRoute)
  @Access(...manage)
  previewRules(
    @Input() input: RouteInput<typeof previewSyncRulesRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { projectId, provider } = input.param;
    return this.rules.previewRules(
      projectId,
      provider,
      input.json.rules,
      workspaceId,
    );
  }

  @ApiRoute(saveSyncRulesRoute)
  @Access(...manage)
  saveRules(
    @Input() input: RouteInput<typeof saveSyncRulesRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { projectId, provider } = input.param;
    const { rules, previewToken } = input.json;
    return this.rules.saveRules(
      projectId,
      provider,
      rules,
      previewToken,
      workspaceId,
    );
  }

  @ApiRoute(reviewSyncResumeRoute)
  @Access(...manage)
  async reviewResume(
    @Input() input: RouteInput<typeof reviewSyncResumeRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { projectId, provider, linkId } = input.param;
    const review = await this.reviews.review(
      projectId,
      provider,
      linkId,
      workspaceId,
    );
    return {
      task: {
        id: review.task.id,
        number: review.task.number,
        title: review.task.title,
      },
      local: review.local,
      remote: review.remote,
      token: review.token,
    };
  }

  @ApiRoute(resumeSyncRoute)
  @Access(...manage, requireWorkspacePermission({ task: ["update"] }))
  resume(
    @Input() input: RouteInput<typeof resumeSyncRoute>,
    @ResolvedWorkspaceId() workspaceId: string,
  ) {
    const { projectId, provider, linkId } = input.param;
    const { source, token } = input.json;
    return this.resumes.resumeSync(
      projectId,
      provider,
      linkId,
      token,
      source,
      workspaceId,
    );
  }
}
