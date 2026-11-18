import { HTTPException } from "../common/errors/http-exception";

/**
 * Storage coordinates are private implementation details, even on mutations
 * that return a full database row. Preserves each endpoint's other fields.
 */
export function toPublicProject<
  T extends {
    backgroundObjectKey: string | null;
    backgroundMimeType: string | null;
  },
>(project: T | undefined) {
  if (!project)
    throw new HTTPException(500, {
      message: "Project mutation returned no result",
    });
  const {
    backgroundObjectKey: _key,
    backgroundMimeType: _mime,
    ...publicProject
  } = project;
  return publicProject;
}
