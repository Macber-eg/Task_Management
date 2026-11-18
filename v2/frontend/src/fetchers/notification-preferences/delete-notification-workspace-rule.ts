import { apiFetch } from "@/lib/api";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";
import type { NotificationPreferences } from "./get-notification-preferences";

async function deleteNotificationWorkspaceRule(
  workspaceId: string,
): Promise<NotificationPreferences> {
  const response = await apiFetch(
    getApiUrl(`/notification-preferences/workspaces/${workspaceId}`),
    {
      credentials: "include",
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return (await response.json()) as NotificationPreferences;
}

export default deleteNotificationWorkspaceRule;
