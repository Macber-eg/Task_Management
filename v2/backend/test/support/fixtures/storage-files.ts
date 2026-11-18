/** The smallest valid PNG: a 1x1 transparent pixel. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A JPEG start-of-image marker and JFIF header, enough to be detected. */
export const JPEG_BYTES = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffd9",
  "hex",
);

/** A multipart body with one file in the `file` field plus text fields. */
export function uploadForm(
  file: { bytes: Uint8Array; type: string; name: string } | null,
  fields: Record<string, string> = {},
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  if (file)
    form.append(
      "file",
      new Blob([new Uint8Array(file.bytes)], { type: file.type }),
      file.name,
    );
  return form;
}

export function postForm(form: FormData): RequestInit {
  return { method: "POST", body: form };
}
