import { Logger } from "@nestjs/common";
import { ExternalLinkEntity } from "../../../database/entities/external-link.entity";
import { dispatchIssueWrite } from "../../sync/dispatch-issue-write";
import { canSyncTask } from "../../sync/eligibility";
import type { GitHubOctokit } from "../app/github-app";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import type { GitHubDeps } from "../github-deps";
import { toHexColor } from "./to-hex-color";

const logger = new Logger("GitHubLabelSync");

type LabelContext = {
  externalLink: ExternalLinkEntity;
  expectedConfig: string;
  octokit: GitHubOctokit;
  owner: string;
  repo: string;
  issueNumber: number;
};

// The previous backend looked at the task's first external link only.
async function githubContext(
  deps: GitHubDeps,
  taskId: string,
): Promise<LabelContext | null> {
  const externalLink = await deps.db.findOne(ExternalLinkEntity, {
    where: { taskId },
    relations: { integration: true },
  });
  if (externalLink?.resourceType !== "issue") return null;

  const integration = externalLink.integration;
  if (integration?.type !== "github" || !integration.isActive) return null;

  if (!(await canSyncTask(deps.db, taskId, integration.id))) return null;

  let config: GitHubConfig;
  try {
    config = JSON.parse(integration.config) as GitHubConfig;
  } catch {
    return null;
  }
  if (!hasVerifiedGitHubBinding(config) || !config.installationId) return null;

  let octokit: GitHubOctokit;
  try {
    octokit = await deps.github.verifiedInstallationOctokit(config);
  } catch {
    return null;
  }

  return {
    externalLink,
    expectedConfig: integration.config,
    octokit,
    owner: config.repositoryOwner,
    repo: config.repositoryName,
    issueNumber: Number.parseInt(externalLink.externalId, 10),
  };
}

/** A label created on or assigned to a task (the previous `syncLabelToGitHub`). */
export async function syncLabelToGitHub(
  deps: GitHubDeps,
  taskId: string,
  labelName: string,
  labelColor: string,
): Promise<void> {
  const ctx = await githubContext(deps, taskId);
  if (!ctx) return;

  const { octokit, owner, repo, issueNumber } = ctx;
  const color = toHexColor(labelColor);

  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: labelName });
  } catch {
    try {
      const created = await dispatchIssueWrite(
        deps.db,
        ctx.externalLink,
        ctx.expectedConfig,
        () => octokit.rest.issues.createLabel({ owner, repo, name: labelName, color }),
      );
      if (!created) return;
    } catch (createError) {
      logger.error(
        `Failed to create label "${labelName}" in GitHub: ${String(createError)}`,
      );
      return;
    }
  }

  try {
    await dispatchIssueWrite(deps.db, ctx.externalLink, ctx.expectedConfig, () =>
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [labelName],
      }),
    );
  } catch (error) {
    logger.error(
      `Failed to add label "${labelName}" to GitHub issue: ${String(error)}`,
    );
  }
}

/** A label removed from a task (the previous `removeLabelFromGitHub`). */
export async function removeLabelFromGitHub(
  deps: GitHubDeps,
  taskId: string,
  labelName: string,
): Promise<void> {
  const ctx = await githubContext(deps, taskId);
  if (!ctx) return;

  const { octokit, owner, repo, issueNumber } = ctx;
  try {
    await dispatchIssueWrite(deps.db, ctx.externalLink, ctx.expectedConfig, () =>
      octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      }),
    );
  } catch (error) {
    logger.error(
      `Failed to remove label "${labelName}" from GitHub issue: ${String(error)}`,
    );
  }
}
