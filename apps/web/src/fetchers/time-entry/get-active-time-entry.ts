import { resolveApiBaseUrl } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type ActiveTimeEntryDetails = {
  id: string;
  taskId: string;
  userId: string | null;
  description: string | null;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  createdAt: string;
  updatedAt: string;
  taskTitle: string;
  taskNumber: number;
  projectId: string;
  workspaceId: string;
  projectSlug: string;
};

export type ActiveTimeEntryResponse = {
  running: ActiveTimeEntryDetails | null;
};

async function getActiveTimeEntry() {
  const base = resolveApiBaseUrl(import.meta.env.VITE_API_URL).replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${base}/time-entry/active`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return (await response.json()) as ActiveTimeEntryResponse;
}

export default getActiveTimeEntry;
