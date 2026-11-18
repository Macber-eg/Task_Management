import { Logger } from "@nestjs/common";
import { errorText } from "../../git-shared/error-text";
import type { IssueWrite } from "../../sync/issue-write";
import { createGiteaClient } from "../client/gitea-client";
import type { GiteaLabel } from "../client/gitea-types";
import type { GiteaConfig } from "../config";

const logger = new Logger("GiteaIssueLabels");

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

const directWrite: IssueWrite = (send) => send();

/**
 * The repository label ids for `labels`, creating missing ones. Failures are
 * logged and skipped unless `requireSuccess`.
 */
export async function ensureLabelsExistGitea(
  config: GiteaConfig,
  labels: string[],
  requireSuccess = false,
  write: IssueWrite = directWrite,
): Promise<Map<string, number>> {
  const client = createGiteaClient(config);
  const map = new Map<string, number>();
  const { repositoryOwner, repositoryName } = config;

  let existingLabels: GiteaLabel[];
  try {
    existingLabels = await client.listLabels(repositoryOwner, repositoryName);
  } catch (error) {
    if (requireSuccess) throw error;
    logger.error(
      `Failed to list Gitea labels (${repositoryOwner}/${repositoryName}): ${errorText(error)}`,
    );
    return map;
  }

  const nameToId = new Map(existingLabels.map((l) => [l.name, l.id]));

  for (const name of labels) {
    try {
      const existingId = nameToId.get(name);
      if (existingId !== undefined) {
        map.set(name, existingId);
        continue;
      }

      const created = await write(() =>
        client.createLabel(
          repositoryOwner,
          repositoryName,
          name,
          labelColors[name] || "6B7280",
        ),
      );
      nameToId.set(name, created.id);
      map.set(name, created.id);
    } catch (error) {
      if (requireSuccess) throw error;
      logger.error(`Failed to ensure Gitea label "${name}": ${errorText(error)}`);
    }
  }
  return map;
}

export async function addLabelsToIssueGitea(
  config: GiteaConfig,
  issueIndex: number,
  labelNames: string[],
  requireSuccess = false,
  write: IssueWrite = directWrite,
): Promise<void> {
  if (labelNames.length === 0) return;

  const nameToId = await ensureLabelsExistGitea(
    config,
    labelNames,
    requireSuccess,
    write,
  );
  const ids: number[] = [];
  for (const name of labelNames) {
    const id = nameToId.get(name);
    if (id !== undefined) ids.push(id);
  }

  if (ids.length === 0) return;

  const client = createGiteaClient(config);

  try {
    await write(() =>
      client.addLabelsToIssue(
        config.repositoryOwner,
        config.repositoryName,
        issueIndex,
        ids,
      ),
    );
  } catch (error) {
    if (requireSuccess) throw error;
    logger.error(`Failed to add labels to Gitea issue: ${errorText(error)}`);
  }
}

export async function removeLabelGitea(
  config: GiteaConfig,
  issueIndex: number,
  labelName: string,
  write: IssueWrite = directWrite,
  requireSuccess = false,
): Promise<void> {
  const client = createGiteaClient(config);
  const target = `${config.repositoryOwner}/${config.repositoryName}#${issueIndex}`;
  let labels: GiteaLabel[];
  try {
    labels = await client.listLabels(
      config.repositoryOwner,
      config.repositoryName,
    );
  } catch (error) {
    if (requireSuccess) throw error;
    logger.error(
      `Failed to list Gitea labels for removal of "${labelName}" (${target}): ${errorText(error)}`,
    );
    return;
  }

  const label = labels.find((l) => l.name === labelName);
  if (!label) return;

  try {
    await write(() =>
      client.removeLabelFromIssue(
        config.repositoryOwner,
        config.repositoryName,
        issueIndex,
        label.id,
      ),
    );
  } catch (error) {
    if (requireSuccess) throw error;
    logger.error(
      `Failed to remove label "${labelName}" (${label.id}) from Gitea issue ${target}: ${errorText(error)}`,
    );
  }
}
