import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { ExternalLinkEntity } from "../../database/entities/external-link.entity";
import { TaskEntity } from "../../database/entities/task.entity";
import { isTaskInFinalState } from "../links/integration-tasks";
import { taskMatchesRule } from "../sync/eligibility";
import { ProviderIssues } from "../sync/provider-issues";
import { isSyncPaused, readSyncRules } from "../sync/rules";
import { getAuthorizedSyncProject } from "./get-authorized-sync-project";
import { getSyncIntegration } from "./get-sync-integration";
import type { ResumeProviderSnapshot } from "./resume-provider-snapshot";

export type SyncResumeReview = Awaited<
  ReturnType<SyncResumeReviewService["review"]>
>;

/** Compares a paused task with its provider issue for an explicit resume. */
@Injectable()
export class SyncResumeReviewService {
  private readonly logger = new Logger(SyncResumeReviewService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly issues: ProviderIssues,
  ) {}

  /**
   * The local and remote values and a token over everything compared. Reads
   * the provider unless `providerSnapshot` (from an earlier phase) is given.
   */
  async review(
    projectId: string,
    provider: string,
    linkId: string,
    authorizedWorkspaceId: string,
    db: EntityManager = this.dataSource.manager,
    providerSnapshot?: ResumeProviderSnapshot,
  ) {
    const integration = await getSyncIntegration(db, projectId, provider);
    if (integration.project.workspaceId !== authorizedWorkspaceId)
      throw new HTTPException(403, {
        message: "Project no longer belongs to the authorized workspace",
      });
    const link = await db.findOne(ExternalLinkEntity, {
      where: { id: linkId, integrationId: integration.id, resourceType: "issue" },
    });
    const task =
      link &&
      (await db.findOne(TaskEntity, { where: { id: link.taskId, projectId } }));
    if (!link || !task)
      throw new HTTPException(404, { message: "Linked task not found" });
    if (
      !integration.isActive ||
      !isSyncPaused(link.metadata) ||
      !(await taskMatchesRule(
        db,
        task.id,
        projectId,
        readSyncRules(integration.config)!.outgoing,
      ))
    )
      throw new HTTPException(409, {
        message:
          "The task must match the current rule and be paused before resuming",
      });
    const local = {
      title: task.title,
      description: task.description ?? "",
      state: (await isTaskInFinalState(db, task))
        ? ("closed" as const)
        : ("open" as const),
    };
    let snapshot = providerSnapshot;
    if (!snapshot) {
      try {
        const access = await this.issues.open(integration, link);
        snapshot = { access, remoteIssue: await access.read() };
      } catch {
        this.logger.error(
          `Sync resume provider read failed (project ${projectId}, ${provider}, link ${linkId})`,
        );
        throw new HTTPException(502, {
          message: "External issue could not be read; sync remains paused",
        });
      }
    }
    // Provider latency must not allow a moved project's comparison to escape.
    await getAuthorizedSyncProject(db, projectId, authorizedWorkspaceId);
    const { remoteIssue } = snapshot;
    const remote = {
      title: remoteIssue.title,
      description: remoteIssue.description,
      state: remoteIssue.state,
    };
    const token = createHash("sha256")
      .update(
        JSON.stringify({
          binding: [integration.id, integration.config],
          task,
          link,
          local,
          remoteIssue,
        }),
      )
      .digest("hex");
    return {
      integration,
      link,
      task,
      snapshot,
      local,
      remote,
      remoteIssueLabels: remoteIssue.labels,
      remoteIssueUpdatedAt: remoteIssue.updatedAt,
      token,
    };
  }
}
