import { createHmac } from "node:crypto";
import type { EntityManager } from "typeorm";
import { IntegrationEntity } from "../../../src/database/entities/integration.entity";
import { insertRow } from "./insert-row";

export const GITHUB_TEST_WEBHOOK_SECRET = "github-test-webhook-secret";

/** A verified binding to installation 10, repository 20 (`owner/repo`). */
export function verifiedGitHubConfig(extra: Record<string, unknown> = {}) {
  return {
    repositoryOwner: "owner",
    repositoryName: "repo",
    installationId: 10,
    repositoryId: 20,
    verifiedGithubAccountId: "30",
    verifiedByUserId: "operator",
    ...extra,
  };
}

/** The webhook `installation` and `repository` that match `verifiedGitHubConfig`. */
export const githubWebhookSource = {
  installation: { id: 10 },
  repository: {
    id: 20,
    owner: { login: "owner" },
    name: "repo",
    full_name: "owner/repo",
    html_url: "https://github.com/owner/repo",
  },
};

export function insertGitHubIntegration(
  db: EntityManager,
  projectId: string,
  config: Record<string, unknown> = verifiedGitHubConfig(),
  isActive = true,
): Promise<IntegrationEntity> {
  return insertRow(db, IntegrationEntity, {
    projectId,
    type: "github",
    isActive,
    config: JSON.stringify(config),
  });
}

/** GitHub's `X-Hub-Signature-256` for `body`. */
export function signGitHubWebhook(
  body: string,
  secret = GITHUB_TEST_WEBHOOK_SECRET,
): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Headers of a signed delivery of `event`. */
export function githubWebhookHeaders(event: string, body: string) {
  return {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": `delivery-${Date.now()}`,
    "x-hub-signature-256": signGitHubWebhook(body),
  };
}
