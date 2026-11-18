import { vi } from "vitest";
import type { CreemClient } from "../../../src/billing/creem-client";

/** Replaces the Creem API in integration tests; nothing reaches Creem. */
export function creemDouble() {
  return {
    createCheckoutSession: vi.fn<CreemClient["createCheckoutSession"]>(
      async () => ({ checkoutUrl: "https://checkout.example.invalid/session" }),
    ),
    updateSubscriptionSeats: vi.fn<CreemClient["updateSubscriptionSeats"]>(
      async () => {},
    ),
    createCustomerPortalLink: vi.fn<CreemClient["createCustomerPortalLink"]>(
      async () => ({ portalUrl: "https://portal.example.invalid/link" }),
    ),
  };
}

export type CreemDouble = ReturnType<typeof creemDouble>;

export function resetCreemDouble(creem: CreemDouble): void {
  creem.createCheckoutSession
    .mockReset()
    .mockResolvedValue({ checkoutUrl: "https://checkout.example.invalid/session" });
  creem.updateSubscriptionSeats.mockReset().mockResolvedValue(undefined);
  creem.createCustomerPortalLink
    .mockReset()
    .mockResolvedValue({ portalUrl: "https://portal.example.invalid/link" });
}
