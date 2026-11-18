import { z } from "../common/openapi";

export const invitationParam = z.object({ id: z.string() });
