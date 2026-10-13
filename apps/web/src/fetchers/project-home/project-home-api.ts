import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json() as Promise<T>;
}

export type ProjectBookmark = {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRecentItem = {
  id: string;
  projectId: string;
  itemType: "phase" | "sprint" | "task" | "document";
  itemId: string;
  title: string;
  parentLabel: string | null;
  accessedAt: string;
};

export type ProjectAssetRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind: string;
  taskId: string | null;
  createdAt: string;
};

export async function fetchProjectBookmarks(projectId: string) {
  return parseJson<ProjectBookmark[]>(
    await fetch(getApiUrl(`project-home/bookmarks/${projectId}`), {
      credentials: "include",
    }),
  );
}

export async function createProjectBookmark(
  projectId: string,
  body: { title: string; url: string },
) {
  return parseJson<ProjectBookmark>(
    await fetch(getApiUrl(`project-home/bookmarks/${projectId}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function updateProjectBookmark(
  id: string,
  body: { title: string; url: string },
) {
  return parseJson<ProjectBookmark>(
    await fetch(getApiUrl(`project-home/bookmark/${id}`), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteProjectBookmark(id: string) {
  return parseJson<ProjectBookmark>(
    await fetch(getApiUrl(`project-home/bookmark/${id}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

export async function fetchProjectRecent(projectId: string) {
  return parseJson<ProjectRecentItem[]>(
    await fetch(getApiUrl(`project-home/recent/${projectId}`), {
      credentials: "include",
    }),
  );
}

export async function recordProjectRecent(
  projectId: string,
  body: {
    itemType: ProjectRecentItem["itemType"];
    itemId: string;
    title: string;
    parentLabel?: string | null;
  },
) {
  return parseJson<ProjectRecentItem[]>(
    await fetch(getApiUrl(`project-home/recent/${projectId}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function fetchProjectHomeAssets(projectId: string) {
  return parseJson<ProjectAssetRow[]>(
    await fetch(getApiUrl(`project-home/assets/${projectId}`), {
      credentials: "include",
    }),
  );
}
