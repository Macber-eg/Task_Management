import { setTimeout as delay } from "node:timers/promises";
import { type GitlabConfig, tokenTypeOf } from "../config";
import { normalizeProjectPath } from "../gitlab-url";
import {
  isResourceLock,
  requiredGitlabResponse as required,
} from "./gitlab-api-error";
import { gitlabFetch } from "./gitlab-fetch";
import type {
  GitlabIssue,
  GitlabLabel,
  GitlabMergeRequest,
  GitlabNote,
  GitlabProject,
} from "./gitlab-types";

export type GitlabClient = ReturnType<typeof createGitlabClient>;

export function createGitlabClient(
  config: Pick<GitlabConfig, "baseUrl" | "accessToken" | "tokenType">,
) {
  const { baseUrl, accessToken } = config;
  const tokenType = tokenTypeOf(config);
  const project = (path: string) =>
    `/projects/${encodeURIComponent(normalizeProjectPath(path))}`;

  const call = <T>(path: string, init?: RequestInit) =>
    gitlabFetch<T>(baseUrl, accessToken, tokenType, path, init);

  return {
    async getProject(projectPath: string): Promise<GitlabProject> {
      return required(
        await call<GitlabProject>(project(projectPath)),
        "project",
      );
    },

    async listMemberProjects(page = 1, perPage = 50): Promise<GitlabProject[]> {
      return required(
        await call<GitlabProject[]>(
          `/projects?membership=true&simple=true&order_by=last_activity_at&per_page=${perPage}&page=${page}`,
        ),
        "projects",
      );
    },

    async createIssue(
      projectPath: string,
      body: { title: string; description?: string | null },
    ): Promise<GitlabIssue> {
      return required(
        await call<GitlabIssue>(`${project(projectPath)}/issues`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
        "create issue",
      );
    },

    async updateIssue(
      projectPath: string,
      iid: number,
      body: Record<string, unknown>,
    ): Promise<GitlabIssue> {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return required(
            await call<GitlabIssue>(`${project(projectPath)}/issues/${iid}`, {
              method: "PUT",
              body: JSON.stringify(body),
            }),
            "update issue",
          );
        } catch (error) {
          // Concurrent edits can briefly lock an issue. Retry only this rejected
          // update, not creates or ambiguous failures that may have succeeded.
          if (attempt >= 3 || !isResourceLock(error)) {
            throw error;
          }
          await delay(250 * 2 ** attempt);
        }
      }
    },

    async getIssue(projectPath: string, iid: number): Promise<GitlabIssue> {
      return required(
        await call<GitlabIssue>(`${project(projectPath)}/issues/${iid}`),
        "issue",
      );
    },

    async listIssues(
      projectPath: string,
      page: number,
      state: "opened" | "closed" | "all",
    ): Promise<GitlabIssue[]> {
      return required(
        await call<GitlabIssue[]>(
          `${project(projectPath)}/issues?state=${state}&order_by=created_at&sort=asc&per_page=100&page=${page}`,
        ),
        "issues",
      );
    },

    async listIssueNotes(
      projectPath: string,
      iid: number,
      page: number,
      perPage: number,
    ): Promise<GitlabNote[]> {
      return required(
        await call<GitlabNote[]>(
          `${project(projectPath)}/issues/${iid}/notes?sort=asc&order_by=created_at&per_page=${perPage}&page=${page}`,
        ),
        "notes",
      );
    },

    async createIssueNote(
      projectPath: string,
      iid: number,
      body: string,
    ): Promise<GitlabNote> {
      return required(
        await call<GitlabNote>(`${project(projectPath)}/issues/${iid}/notes`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }),
        "create note",
      );
    },

    async listLabels(projectPath: string): Promise<GitlabLabel[]> {
      const all: GitlabLabel[] = [];
      let page = 1;

      while (page <= 20) {
        const batch = required(
          await call<GitlabLabel[]>(
            `${project(projectPath)}/labels?per_page=100&page=${page}`,
          ),
          "labels",
        );
        all.push(...batch);
        if (batch.length < 100) break;
        page += 1;
      }

      return all;
    },

    async createLabel(
      projectPath: string,
      name: string,
      color: string,
    ): Promise<GitlabLabel> {
      return required(
        await call<GitlabLabel>(`${project(projectPath)}/labels`, {
          method: "POST",
          body: JSON.stringify({
            name,
            color: `#${color.replace(/^#/, "")}`,
          }),
        }),
        "create label",
      );
    },

    async listMergeRequests(
      projectPath: string,
      page: number,
    ): Promise<GitlabMergeRequest[]> {
      return required(
        await call<GitlabMergeRequest[]>(
          `${project(projectPath)}/merge_requests?state=opened&per_page=100&page=${page}`,
        ),
        "merge requests",
      );
    },
  };
}
