import { client } from "@/lib/api";
import { HttpError } from "@/lib/http-error";

/** Uploads a board background image and makes it the project's background. */
export async function uploadProjectBackground(projectId: string, file: File) {
  const response = await client.project[":id"]["background-upload"].$post({
    param: { id: projectId },
    form: { file },
  });
  if (!response.ok) throw await HttpError.fromResponse(response);

  return response.json();
}

export async function removeProjectBackground(projectId: string) {
  const response = await client.project[":id"].background.$delete({
    param: { id: projectId },
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
}
