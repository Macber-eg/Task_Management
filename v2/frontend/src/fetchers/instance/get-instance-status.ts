import { apiFetch, apiUrl } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type InstanceStatus = {
  hasUsers: boolean;
  hasAdmin: boolean;
};

export async function getInstanceStatus(): Promise<InstanceStatus> {
  const response = await apiFetch(apiUrl("instance/status"));

  if (!response.ok) {
    const error = await HttpError.fromResponse(response);
    throw new HttpError(
      response.status,
      `Failed to fetch instance status: ${error.message}`,
      error,
    );
  }

  return response.json();
}
