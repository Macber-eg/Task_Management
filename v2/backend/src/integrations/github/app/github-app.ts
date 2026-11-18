import { Injectable } from "@nestjs/common";
import { App, Octokit } from "octokit";
import {
  type GitHubConfig,
  hasVerifiedGitHubBinding,
} from "../config/github-config";
import { boundedGithubFetch } from "./bounded-github-fetch";
import { resolveGithubPrivateKey } from "./resolve-private-key";

export type GitHubOctokit = Octokit;

/**
 * The GitHub App this instance runs as (`GITHUB_APP_ID`, the private key and
 * `GITHUB_WEBHOOK_SECRET`). `app()` is null while any of them is missing;
 * every GitHub feature is then unavailable. The bounded variant (imports,
 * resume review, deferred edits) caps response size and time and never
 * retries or throttles.
 */
@Injectable()
export class GitHubApp {
  private standard: App | null = null;
  private bounded: App | null = null;

  app(boundedImport = false): App | null {
    const existing = boundedImport ? this.bounded : this.standard;
    if (existing) return existing;

    const privateKey = resolveGithubPrivateKey();
    if (
      !process.env.GITHUB_WEBHOOK_SECRET ||
      !process.env.GITHUB_APP_ID ||
      !privateKey
    ) {
      return null;
    }

    const app = new App({
      ...(boundedImport
        ? {
            Octokit: Octokit.defaults({
              throttle: { enabled: false },
              retry: { enabled: false },
              request: { fetch: boundedGithubFetch, timeout: 10_000 },
            }),
          }
        : {}),
      appId: process.env.GITHUB_APP_ID ?? "",
      privateKey,
      webhooks: { secret: process.env.GITHUB_WEBHOOK_SECRET ?? "" },
    });

    if (boundedImport) this.bounded = app;
    else this.standard = app;
    return app;
  }

  async installationOctokit(
    installationId: number,
    boundedImport = false,
  ): Promise<GitHubOctokit> {
    const app = this.app(boundedImport);
    if (!app) {
      throw new Error("GitHub App not configured");
    }
    return (await app.getInstallationOctokit(
      installationId,
    )) as unknown as GitHubOctokit;
  }

  /** Prevent name reuse or transfer from redirecting writes to a different repository. */
  async verifiedInstallationOctokit(
    config: GitHubConfig,
    boundedImport = false,
  ): Promise<GitHubOctokit> {
    if (!hasVerifiedGitHubBinding(config) || !config.installationId) {
      throw new Error("GitHub integration requires verification");
    }
    const octokit = await this.installationOctokit(
      config.installationId,
      boundedImport,
    );
    const { data: repository } = await octokit.rest.repos.get({
      owner: config.repositoryOwner,
      repo: config.repositoryName,
      request: { timeout: 10_000 },
    });
    if (repository.id !== config.repositoryId) {
      throw new Error(
        "GitHub repository identity changed; reconnect the integration",
      );
    }
    return octokit;
  }
}
