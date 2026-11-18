import { isCloud } from "./is-cloud";

export function isBillingEnabled(): boolean {
  return Boolean(
    isCloud() && process.env.CREEM_API_KEY && process.env.CREEM_WEBHOOK_SECRET,
  );
}
