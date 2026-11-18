import { Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import { createGitlabClient } from "../client/gitlab-client";
import type { GitlabConfig } from "../config";
import { errorText } from "../../git-shared/error-text";
import { toHexColor } from "../../git-shared/to-hex-color";

const logger = new Logger("GitlabLabelSync");

async function getGitlabIssueContext(db: EntityManager, taskId: string) {
  const externalLinks = await db.find(ExternalLinkEntity, {
    where: { taskId },
    relations: { integration: true },
  });

  // Called from label controllers, bypassing the registry's isActive filter.
  const externalLink = externalLinks.find(
    (link) =>
      link.resourceType === "issue" &&
      link.integration?.type === "gitlab" &&
      link.integration.isActive === true,
  );

  if (!externalLink?.integration) {
    return null;
  }

  if (!(await canSyncTask(db, taskId, externalLink.integration.id)))
    return null;

  let config: GitlabConfig;
  try {
    config = JSON.parse(externalLink.integration.config) as GitlabConfig;
  } catch {
    return null;
  }

  if (!config.accessToken || !config.baseUrl) {
    return null;
  }

  const issueIid = Number.parseInt(externalLink.externalId, 10);
  if (Number.isNaN(issueIid)) {
    logger.warn(
      `Invalid GitLab issue externalId for label sync (link ${externalLink.id}, task ${taskId})`,
    );
    return null;
  }

  return {
    externalLink,
    expectedConfig: externalLink.integration.config,
    client: createGitlabClient(config),
    config,
    issueIid,
  };
}

function containsTaskFieldLabel(labelName: string) {
  // GitLab interprets add_labels/remove_labels as comma-separated names.
  return labelName.split(",").some((name) => {
    const label = name.trim();
    return label.startsWith("priority:") || label.startsWith("status:");
  });
}

/** A label was created on or assigned to a task (`syncLabelToGitlab`). */
export async function syncLabelToGitlab(
  db: EntityManager,
  taskId: string,
  labelName: string,
  labelColor: string,
) {
  // These labels drive task fields on the webhook return path. Ordinary label
  // permissions must not grant the ability to update status or priority.
  if (containsTaskFieldLabel(labelName)) return;
  const ctx = await getGitlabIssueContext(db, taskId);
  if (!ctx) return;

  const { client, config, issueIid } = ctx;

  const labels = await client.listLabels(config.projectPath);

  if (!labels.some((l) => l.name === labelName)) {
    try {
      const created = await dispatchIssueWrite(
        db,
        ctx.externalLink,
        ctx.expectedConfig,
        () =>
          client.createLabel(
            config.projectPath,
            labelName,
            toHexColor(labelColor),
          ),
      );
      if (!created) return;
    } catch (error) {
      logger.error(
        `Failed to create label "${labelName}" in GitLab: ${errorText(error)}`,
      );
      return;
    }
  }

  try {
    const issue = await client.getIssue(config.projectPath, issueIid);
    if (issue.labels?.includes(labelName)) {
      return;
    }
    await dispatchIssueWrite(db, ctx.externalLink, ctx.expectedConfig, () =>
      client.updateIssue(config.projectPath, issueIid, {
        add_labels: labelName,
      }),
    );
  } catch (error) {
    logger.error(
      `Failed to add label "${labelName}" to GitLab issue: ${errorText(error)}`,
    );
  }
}

/** A label was removed from a task (`removeLabelFromGitlab`). */
export async function removeLabelFromGitlab(
  db: EntityManager,
  taskId: string,
  labelName: string,
) {
  if (containsTaskFieldLabel(labelName)) return;
  const ctx = await getGitlabIssueContext(db, taskId);
  if (!ctx) return;

  const { client, config, issueIid } = ctx;

  try {
    await dispatchIssueWrite(db, ctx.externalLink, ctx.expectedConfig, () =>
      client.updateIssue(config.projectPath, issueIid, {
        remove_labels: labelName,
      }),
    );
  } catch (error) {
    logger.error(
      `Failed to remove label "${labelName}" from GitLab issue: ${errorText(error)}`,
    );
  }
}
