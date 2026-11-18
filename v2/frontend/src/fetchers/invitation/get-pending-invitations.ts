import { client, type InferResponseType } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

export type PendingInvitation = InferResponseType<
  typeof client.invitation.pending.$get
>[number];

export async function getPendingInvitations(): Promise<PendingInvitation[]> {
  const response = await client.invitation.pending.$get();

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to get pending invitations");
  }

  return response.json();
}
