import { Logger } from "@nestjs/common";
import type { IssueWrite } from "../../sync/issue-write";
import type { GitHubOctokit } from "../app/github-app";

const logger = new Logger("GitHubLabels");

const labelColors: Record<string, string> = {
  "priority:low": "0EA5E9",
  "priority:medium": "EAB308",
  "priority:high": "F97316",
  "priority:urgent": "EF4444",
  "status:to-do": "6B7280",
  "status:in-progress": "3B82F6",
  "status:in-review": "8B5CF6",
  "status:done": "10B981",
  "status:planned": "8B5CF6",
  "status:archived": "6B7280",
};

export function getLabelColor(labelName: string): string {
  return labelColors[labelName] || "6B7280";
}

export async function ensureLabelsExist(
  octokit: GitHubOctokit,
  owner: string,
  repo: string,
  labels: string[],
  requireSuccess = false,
  write: IssueWrite = (send) => send(),
) {
  for (const labelName of labels) {
    try {
      await octokit.rest.issues.getLabel({
        owner,
        repo,
        name: labelName,
      });
    } catch {
      try {
        const color = getLabelColor(labelName);
        await write(() =>
          octokit.rest.issues.createLabel({
            owner,
            repo,
            name: labelName,
            color,
          }),
        );
      } catch (createError) {
        if (requireSuccess) throw createError;
        logger.error(
          `Failed to create label "${labelName}": ${String(createError)}`,
        );
      }
    }
  }
}

export async function addLabelsToIssue(
  octokit: GitHubOctokit,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
  requireSuccess = false,
  write: IssueWrite = (send) => send(),
) {
  try {
    await ensureLabelsExist(
      octokit,
      owner,
      repo,
      labels,
      requireSuccess,
      write,
    );

    await write(() =>
      octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels,
      }),
    );
  } catch (error) {
    if (requireSuccess) throw error;
    logger.error(`Failed to add labels to issue: ${String(error)}`);
  }
}

export async function removeLabel(
  octokit: GitHubOctokit,
  owner: string,
  repo: string,
  issueNumber: number,
  labelName: string,
  write: IssueWrite = (send) => send(),
) {
  try {
    await write(() =>
      octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      }),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404
    ) {
      return;
    }

    logger.error(
      `Failed to remove label "${labelName}" from issue: ${String(error)}`,
    );
    throw error;
  }
}
