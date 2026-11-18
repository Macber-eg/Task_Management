import type { GiteaConfig } from "../config";
import { emptyGiteaResponse } from "./gitea-api-error";
import { giteaFetch } from "./gitea-fetch";
import type {
  GiteaComment,
  GiteaIssue,
  GiteaLabel,
  GiteaPullRequest,
  GiteaRepository,
  GiteaRepositoryListItem,
} from "./gitea-types";

const MAX_LABELS_PER_REQUEST = 50;

export type GiteaClient = ReturnType<typeof createGiteaClient>;

export function createGiteaClient(
  config: Pick<GiteaConfig, "baseUrl" | "accessToken">,
) {
  const { baseUrl, accessToken } = config;
  const repo = (o: string, r: string) =>
    `/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
  const get = <T>(path: string, init?: RequestInit) =>
    giteaFetch<T>(baseUrl, accessToken, path, init);
  const required = async <T>(
    what: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    const value = await get<T>(path, init);
    if (!value) throw emptyGiteaResponse(what);
    return value;
  };

  return {
    getRepo(owner: string, name: string): Promise<GiteaRepository> {
      return required("repository", repo(owner, name));
    },

    listUserRepos(page = 1, limit = 50): Promise<GiteaRepositoryListItem[]> {
      return required(
        "repositories",
        `/user/repos?page=${page}&limit=${limit}`,
      );
    },

    createIssue(
      owner: string,
      name: string,
      body: { title: string; body?: string | null; closed?: boolean },
    ): Promise<GiteaIssue> {
      return required("create issue", `${repo(owner, name)}/issues`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    updateIssue(
      owner: string,
      name: string,
      index: number,
      body: Record<string, unknown>,
    ): Promise<GiteaIssue> {
      return required("update issue", `${repo(owner, name)}/issues/${index}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },

    listIssueComments(
      owner: string,
      name: string,
      index: number,
      page: number,
      limit: number,
    ): Promise<GiteaComment[]> {
      return required(
        "comments",
        `${repo(owner, name)}/issues/${index}/comments?page=${page}&limit=${limit}`,
      );
    },

    createIssueComment(
      owner: string,
      name: string,
      index: number,
      body: string,
    ): Promise<GiteaComment> {
      return required(
        "create comment",
        `${repo(owner, name)}/issues/${index}/comments`,
        { method: "POST", body: JSON.stringify({ body }) },
      );
    },

    listLabels(owner: string, name: string): Promise<GiteaLabel[]> {
      return required("labels", `${repo(owner, name)}/labels`);
    },

    createLabel(
      owner: string,
      name: string,
      labelName: string,
      color: string,
    ): Promise<GiteaLabel> {
      return required("create label", `${repo(owner, name)}/labels`, {
        method: "POST",
        body: JSON.stringify({ name: labelName, color: color.replace(/^#/, "") }),
      });
    },

    async addLabelsToIssue(
      owner: string,
      name: string,
      index: number,
      labelIds: number[],
    ): Promise<void> {
      const path = `${repo(owner, name)}/issues/${index}/labels`;
      for (let i = 0; i < labelIds.length; i += MAX_LABELS_PER_REQUEST) {
        const chunk = labelIds.slice(i, i + MAX_LABELS_PER_REQUEST);
        await get<unknown>(path, {
          method: "POST",
          body: JSON.stringify({ labels: chunk }),
        });
      }
    },

    async replaceIssueLabels(
      owner: string,
      name: string,
      index: number,
      labelIds: number[],
    ): Promise<void> {
      await get<unknown>(`${repo(owner, name)}/issues/${index}/labels`, {
        method: "PUT",
        body: JSON.stringify({ labels: labelIds }),
      });
    },

    async removeLabelFromIssue(
      owner: string,
      name: string,
      index: number,
      labelId: number,
    ): Promise<void> {
      await get<unknown>(
        `${repo(owner, name)}/issues/${index}/labels/${labelId}`,
        { method: "DELETE" },
      );
    },

    getIssue(owner: string, name: string, index: number): Promise<GiteaIssue> {
      return required("issue", `${repo(owner, name)}/issues/${index}`);
    },

    listIssues(
      owner: string,
      name: string,
      page: number,
      state: "open" | "closed" | "all",
    ): Promise<GiteaIssue[]> {
      return required(
        "issues",
        `${repo(owner, name)}/issues?state=${state}&page=${page}&limit=100`,
      );
    },

    listPulls(
      owner: string,
      name: string,
      page: number,
    ): Promise<GiteaPullRequest[]> {
      return required(
        "pull requests",
        `${repo(owner, name)}/pulls?state=open&page=${page}&limit=100`,
      );
    },
  };
}
