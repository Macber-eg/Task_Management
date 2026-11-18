// Endpoints the app calls that the frozen OpenAPI spec does not document, in
// the same shape openapi-typescript emits so the typed client treats them alike.

type JsonContent<T> = {
  headers: Record<string, unknown>;
  content: { "application/json": T };
};

type WorkspaceIdParameters = {
  query?: never;
  header?: never;
  path: { workspaceId: string };
  cookie?: never;
};

export type BillingEntitlement = {
  active: boolean;
  reason:
    | "billing_disabled"
    | "founding_free"
    | "subscription"
    | "paid_period"
    | "trial"
    | "expired";
};

export type WorkspaceBilling = {
  billingEnabled: boolean;
  entitlement: BillingEntitlement;
  foundingFree: boolean;
  trialEndsAt: string | null;
  plan: string | null;
  billingInterval: string | null;
  status: string | null;
  seats: number;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  hasCustomer: boolean;
};

export type PublicInvitationDetails = {
  valid: boolean;
  invitation?: {
    id: string;
    email: string;
    workspaceName: string;
    inviterName: string;
    expiresAt: string;
    status: string;
    expired: boolean;
  };
  error?: string;
};

export interface extraPaths {
  "/billing/{workspaceId}": {
    get: {
      parameters: WorkspaceIdParameters;
      requestBody?: never;
      responses: { 200: JsonContent<WorkspaceBilling> };
    };
  };
  "/billing/{workspaceId}/checkout": {
    post: {
      parameters: WorkspaceIdParameters;
      requestBody: {
        content: {
          "application/json": {
            plan: "personal" | "team";
            interval: "monthly" | "annual";
          };
        };
      };
      responses: { 200: JsonContent<{ checkoutUrl: string }> };
    };
  };
  "/billing/{workspaceId}/portal": {
    post: {
      parameters: WorkspaceIdParameters;
      requestBody?: never;
      responses: { 200: JsonContent<{ portalUrl: string }> };
    };
  };
  "/invitation/public/{id}": {
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: string };
        cookie?: never;
      };
      requestBody?: never;
      responses: { 200: JsonContent<PublicInvitationDetails> };
    };
  };
}
