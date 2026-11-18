import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { errorText } from "../../git-shared/error-text";
import { toHexColor } from "../../git-shared/to-hex-color";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaConfig } from "../config";

const logger = new Logger("GiteaLabelSync");

async function getGiteaIssueContext(db: EntityManager, taskId: string) {
  const externalLinks = await db.find(ExternalLinkEntity, {
    where: { taskId },
    relations: { integration: true },
  });

  const externalLink = externalLinks.find(
    (link) =>
      link.resourceType === "issue" && link.integration?.type === "gitea",
  );
  const integration = externalLink?.integration;
  if (!externalLink || !integration) return null;

  if (!(await canSyncTask(db, taskId, integration.id))) return null;

  let config: GiteaConfig;
  try {
    config = JSON.parse(integration.config) as GiteaConfig;
  } catch {
    return null;
  }

  if (!config.accessToken || !config.baseUrl) return null;

  const issueNumber = Number.parseInt(externalLink.externalId, 10);
  if (Number.isNaN(issueNumber)) {
    logger.warn(
      `Invalid Gitea issue externalId for label sync (link ${externalLink.id}, task ${taskId})`,
    );
    return null;
  }

  return {
    externalLink,
    expectedConfig: integration.config,
    client: createGiteaClient(config),
    config,
    issueNumber,
  };
}

/** A label was created on or assigned to a task (`syncLabelToGitea`). */
export async function syncLabelToGitea(
  db: EntityManager,
  taskId: string,
  labelName: string,
  labelColor: string,
): Promise<void> {
  const ctx = await getGiteaIssueContext(db, taskId);
  if (!ctx) return;

  const { client, config, issueNumber } = ctx;
  const color = toHexColor(labelColor);

  const labels = await client.listLabels(
    config.repositoryOwner,
    config.repositoryName,
  );
  let label = labels.find((l) => l.name === labelName);

  if (!label) {
    try {
      const created = await dispatchIssueWrite(
        db,
        ctx.externalLink,
        ctx.expectedConfig,
        () =>
          client.createLabel(
            config.repositoryOwner,
            config.repositoryName,
            labelName,
            color,
          ),
      );
      if (!created) return;
      label = created.value;
    } catch (error) {
      logger.error(
        `Failed to create label "${labelName}" in Gitea: ${errorText(error)}`,
      );
      return;
    }
  }

  try {
    const issue = await client.getIssue(
      config.repositoryOwner,
      config.repositoryName,
      issueNumber,
    );
    const labelId = label.id;
    if ((issue.labels ?? []).some((l) => l.id === labelId)) return;
    await dispatchIssueWrite(db, ctx.externalLink, ctx.expectedConfig, () =>
      client.addLabelsToIssue(
        config.repositoryOwner,
        config.repositoryName,
        issueNumber,
        [labelId],
      ),
    );
  } catch (error) {
    logger.error(
      `Failed to add label "${labelName}" to Gitea issue: ${errorText(error)}`,
    );
  }
}

/** A label was removed from a task (`removeLabelFromGitea`). */
export async function removeLabelFromGitea(
  db: EntityManager,
  taskId: string,
  labelName: string,
): Promise<void> {
  const ctx = await getGiteaIssueContext(db, taskId);
  if (!ctx) return;

  const { client, config, issueNumber } = ctx;

  const labels = await client.listLabels(
    config.repositoryOwner,
    config.repositoryName,
  );
  const label = labels.find((l) => l.name === labelName);
  if (!label) return;

  try {
    await dispatchIssueWrite(db, ctx.externalLink, ctx.expectedConfig, () =>
      client.removeLabelFromIssue(
        config.repositoryOwner,
        config.repositoryName,
        issueNumber,
        label.id,
      ),
    );
  } catch (error) {
    logger.error(
      `Failed to remove label "${labelName}" from Gitea issue: ${errorText(error)}`,
    );
  }
}
