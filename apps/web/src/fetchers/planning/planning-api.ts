import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type ProjectPhase = {
  id: string;
  projectId: string;
  parentId?: string | null;
  kind?: string;
  name: string;
  position: number;
  startDate: string | null;
  endDate: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSprint = {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  goal: string | null;
  status: string;
  position: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }
  return response.json() as Promise<T>;
}

export async function fetchPhases(projectId: string) {
  return parseJson<ProjectPhase[]>(
    await fetch(getApiUrl(`planning/phase/${projectId}`), {
      credentials: "include",
    }),
  );
}

export async function fetchSprints(projectId: string) {
  return parseJson<ProjectSprint[]>(
    await fetch(getApiUrl(`planning/sprint/${projectId}`), {
      credentials: "include",
    }),
  );
}

export async function postPhase(
  projectId: string,
  body: {
    name: string;
    parentId?: string | null;
    kind?: "folder" | "document";
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  return parseJson<ProjectPhase>(
    await fetch(getApiUrl(`planning/phase/${projectId}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function reorderPhases(
  projectId: string,
  phases: Array<{ id: string; position: number; parentId?: string | null }>,
) {
  return parseJson<ProjectPhase[]>(
    await fetch(getApiUrl(`planning/phase/reorder/${projectId}`), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phases }),
    }),
  );
}

export async function reorderSprints(
  projectId: string,
  sprints: Array<{ id: string; position: number; phaseId?: string | null }>,
) {
  return parseJson<ProjectSprint[]>(
    await fetch(getApiUrl(`planning/sprint/reorder/${projectId}`), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sprints }),
    }),
  );
}

export async function deletePhaseById(id: string) {
  return parseJson<ProjectPhase>(
    await fetch(getApiUrl(`planning/phase/${id}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}

export async function patchPhase(
  id: string,
  body: {
    name?: string;
    parentId?: string | null;
    kind?: "folder" | "document";
    position?: number;
    archived?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  return parseJson<ProjectPhase>(
    await fetch(getApiUrl(`planning/phase/${id}`), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function patchSprint(
  id: string,
  body: {
    name?: string;
    phaseId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  return parseJson<ProjectSprint>(
    await fetch(getApiUrl(`planning/sprint/${id}`), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function postSprint(
  projectId: string,
  body: {
    name: string;
    phaseId?: string | null;
    goal?: string | null;
    status?: "planned" | "active" | "completed";
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  return parseJson<ProjectSprint>(
    await fetch(getApiUrl(`planning/sprint/${projectId}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteSprintById(id: string) {
  return parseJson<ProjectSprint>(
    await fetch(getApiUrl(`planning/sprint/${id}`), {
      method: "DELETE",
      credentials: "include",
    }),
  );
}
