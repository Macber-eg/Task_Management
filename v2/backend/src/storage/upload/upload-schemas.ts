import type { ZodMediaTypeObject } from "@asteasolutions/zod-to-openapi";
import { z } from "../../common/openapi";

type PlainSchema = Exclude<ZodMediaTypeObject["schema"], z.ZodType>;

// Multipart bodies are described with plain OpenAPI schemas, not Zod: the
// global input interceptor runs before multer has parsed the body, so a Zod
// form schema would be checked against an empty body. The handlers validate
// the parsed fields themselves.

const fileProperty = {
  type: "string" as const,
  format: "binary",
  description: "The file's bytes; its part Content-Type is its content type.",
};

export const taskImageUploadForm: PlainSchema = {
  type: "object",
  properties: {
    file: fileProperty,
    surface: {
      type: "string",
      enum: ["description", "comment"],
      description: "Where the image is used, which decides how it is scoped.",
    },
  },
  required: ["file", "surface"],
};

export const fileOnlyUploadForm: PlainSchema = {
  type: "object",
  properties: { file: fileProperty },
  required: ["file"],
};

export const taskImageUploadFields = z.object({
  surface: z.enum(["description", "comment"]),
});

export const taskImageAssetSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({
      description: "Where the stored image can be read back from.",
    }),
  })
  .openapi("TaskImageAsset");

export const projectBackgroundSchema = z
  .object({ url: z.string() })
  .openapi("ProjectBackgroundFinalize");
