import { HTTPException } from "../../../common/errors/http-exception";

export function importConflict() {
  return new HTTPException(409, {
    message: "GitHub integration or import changed; refresh before resuming",
  });
}
