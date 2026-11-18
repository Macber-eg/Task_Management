import { Injectable, Logger } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { HTTPException } from "../../common/errors/http-exception";
import { EventBus } from "../../events/event-bus";
import { TaskMutationEffects } from "../../task/effects/task-mutation-effects.service";
import type { ProviderIssueSnapshot } from "../core/issue-access";
import { updateExternalLink } from "../links/external-link-writes";
import { withSyncLease } from "../sync/lease";
import { SyncLeaseBusyError } from "../sync/lease-busy-error";
import { applySyncResume, type SyncAdoption } from "./apply-sync-resume";
import { lockResumeScope } from "./lock-resume-scope";
import { SyncResumeReviewService } from "./sync-resume-review.service";
import { verifyResumeProvider } from "./verify-resume-provider";

/** Resumes a reviewed, paused issue link with the chosen side's values. */
@Injectable()
export class SyncResumeService {
  private readonly logger = new Logger(SyncResumeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventBus,
    private readonly effects: TaskMutationEffects,
    private readonly reviews: SyncResumeReviewService,
  ) {}

  async resumeSync(
    projectId: string,
    provider: string,
    linkId: string,
    token: string,
    source: "kaneo" | "provider",
    authorizedWorkspaceId: string,
  ): Promise<{ success: boolean }> {
    try {
      return await withSyncLease(
        this.dataSource.manager,
        `sync-resume:${linkId}`,
        () =>
          this.resumeWithLease(
            projectId,
            provider,
            linkId,
            token,
            source,
            authorizedWorkspaceId,
          ),
      );
    } catch (error) {
      if (error instanceof SyncLeaseBusyError)
        throw new HTTPException(409, { message: error.message });
      throw error;
    }
  }

  private async resumeWithLease(
    projectId: string,
    provider: string,
    linkId: string,
    token: string,
    source: "kaneo" | "provider",
    authorizedWorkspaceId: string,
  ) {
    const db = this.dataSource.manager;
    // Provider latency must not retain a pooled connection or block local edits.
    const initial = await this.reviews.review(
      projectId,
      provider,
      linkId,
      authorizedWorkspaceId,
    );
    const { snapshot } = initial;
    let request:
      | Promise<{ value: ProviderIssueSnapshot } | { error: unknown }>
      | undefined;
    let providerWritten = false;
    let updatedAt: string | null = null;
    let adoption: SyncAdoption | undefined;
    const validate = async (tx: EntityManager) => {
      await lockResumeScope(
        tx,
        projectId,
        provider,
        linkId,
        authorizedWorkspaceId,
      );
      const review = await this.reviews.review(
        projectId,
        provider,
        linkId,
        authorizedWorkspaceId,
        tx,
        snapshot,
      );
      if (review.token !== token)
        throw new HTTPException(409, {
          message: "Task or issue changed; review the comparison again",
        });
      return review;
    };
    try {
      if (source === "kaneo") {
        await this.dataSource.transaction(async (tx) => {
          const review = await validate(tx);
          // Dispatch while scope changes are excluded, then release the locks
          // before awaiting the response. Completion rechecks the local snapshot.
          request = snapshot.access.write(review.local).then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        });
        const result = await request!;
        if ("error" in result) {
          this.logger.error(
            `Sync resume provider write failed (project ${projectId}, ${provider}, link ${linkId})`,
          );
          throw new HTTPException(502, {
            message: "External issue could not be updated; sync remains paused",
          });
        }
        providerWritten = true;
        updatedAt = result.value.updatedAt;
      }
      await this.dataSource.transaction(async (tx) => {
        const review = await validate(tx);
        adoption = await applySyncResume(
          tx,
          this.effects,
          review,
          provider,
          source,
          updatedAt,
        );
      });
    } catch (error) {
      // Dispatch can outlive a failed scope transaction. Observe its result before
      // deciding whether the next comparison must show an uncertain provider edit.
      if (request && !providerWritten)
        providerWritten = "value" in (await request);
      if (providerWritten) {
        await updateExternalLink(db, linkId, {
          metadata: { syncFilterPaused: true, syncResumeUncertain: true },
        });
        await this.events.publish("project.updated", { projectId });
        await this.events.publish("task.updated", {
          projectId,
          taskId: initial.task.id,
        });
      }
      throw error;
    }
    let verificationError: unknown;
    // An issue edit's only webhook may have been discarded while paused, in either
    // resume direction. Read after unpausing so later webhooks can also run.
    try {
      await verifyResumeProvider(
        snapshot,
        source === "kaneo" ? initial.local : initial.remote,
      );
    } catch (error) {
      verificationError = error;
      this.logger.error(
        `Sync resume provider verification failed (project ${projectId}, ${provider}, link ${linkId})`,
      );
      await updateExternalLink(db, linkId, {
        metadata: { syncFilterPaused: true },
      });
    }
    if (adoption)
      await this.effects.publishTaskMutation(
        adoption.before,
        adoption.after,
        undefined,
        {
          fields: ["title", "description", "status"],
          sourceIntegrationId: adoption.integrationId,
        },
      );
    await this.events.publish("task.updated", {
      projectId,
      taskId: initial.task.id,
    });
    await this.events.publish("project.updated", { projectId });
    if (verificationError) throw verificationError;
    return { success: true };
  }
}
