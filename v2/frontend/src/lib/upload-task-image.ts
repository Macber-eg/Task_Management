import createImageUpload from "@/fetchers/task/create-image-upload";

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

type UploadSurface = "description" | "comment";

export function isSupportedImageFile(file: File) {
  return allowedImageMimeTypes.has(file.type.toLowerCase());
}

export function isSupportedTaskAsset(file: File) {
  return file.size > 0;
}

export function getImageAltText(filename: string) {
  return filename
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

/**
 * The file with a name and content type: the API reads both from the
 * multipart part, so an unnamed paste gets `fallbackName` and a file the
 * browser could not classify is sent as binary.
 */
export function asUploadPart(file: File, fallbackName: string) {
  if (file.type && file.name) return file;
  return new File([file], file.name || fallbackName, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

export async function uploadTaskImage({
  taskId,
  surface,
  file,
}: {
  taskId: string;
  surface: UploadSurface;
  file: File;
}) {
  if (!isSupportedImageFile(file)) {
    if (!isSupportedTaskAsset(file)) {
      throw new Error("Only non-empty file uploads are supported.");
    }
  }

  const contentType = file.type || "application/octet-stream";

  const asset = await createImageUpload({
    taskId,
    file: asUploadPart(file, "image"),
    surface,
  });

  return {
    url: asset.url,
    alt: getImageAltText(file.name || "image"),
    filename: file.name || "file",
    kind: isSupportedImageFile(file) ? "image" : "attachment",
    mimeType: contentType,
    size: file.size,
  };
}
