import { client } from "@/lib/api";
import { HttpError } from "@/lib/http-error";
import {
  asUploadPart,
  getImageAltText,
  isSupportedImageFile,
} from "@/lib/upload-task-image";

/** Stages an attachment for a task that does not exist yet. */
export async function uploadDraftAsset(projectId: string, file: File) {
  const part = asUploadPart(file, "file");
  const response = await client.task["draft-upload"][":projectId"].$post({
    param: { projectId },
    form: { file: part },
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  const asset = await response.json();
  return {
    id: asset.id,
    url: asset.url,
    alt: getImageAltText(file.name),
    filename: part.name,
    kind: isSupportedImageFile(file)
      ? ("image" as const)
      : ("attachment" as const),
    mimeType: part.type,
    size: file.size,
  };
}
