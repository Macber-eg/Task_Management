import type { client } from "@/lib/api";
import type { InferResponseType } from "@/lib/api";

export type Notification = Extract<
  InferResponseType<(typeof client)["notification"]["$get"], 200>[number],
  { id: string }
>;

export type NotificationEventData = Record<string, unknown> | null | undefined;
