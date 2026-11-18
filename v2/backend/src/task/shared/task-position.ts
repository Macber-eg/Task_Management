import { HTTPException } from "../../common/errors/http-exception";

export const MAX_TASK_POSITION = 2_147_483_646;

export function assertTaskPosition(position: number) {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > MAX_TASK_POSITION
  ) {
    throw new HTTPException(400, {
      message: `Position must be an integer between 0 and ${MAX_TASK_POSITION}`,
    });
  }
}
