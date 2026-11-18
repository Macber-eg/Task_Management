import { client } from "@/lib/api";

import { HttpError } from "@/lib/http-error";

/** Uploads a task description/comment image or attachment; answers `{ id, url }`. */
async function createImageUpload({
  taskId,
  file,
  surface,
}: {
  taskId: string;
  file: File;
  surface: "description" | "comment";
}) {
  const response = await client.task["image-upload"][":id"].$post({
    param: { id: taskId },
    form: { file, surface },
  });

  if (!response.ok) {
    throw await HttpError.fromResponse(response);
  }

  return response.json();
}

export default createImageUpload;
