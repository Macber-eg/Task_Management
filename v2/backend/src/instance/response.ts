import { z } from "../common/openapi";

export const instanceStatusSchema = z
  .object({ hasUsers: z.boolean(), hasAdmin: z.boolean() })
  .openapi("InstanceStatus");
