/** The fields Kaneo reads from a Creem checkout or subscription object. */
export type WebhookObject = {
  id?: string;
  status?: string;
  metadata?: Record<string, string>;
  product?: { id?: string };
  customer?: { id?: string };
  subscription?: {
    id?: string;
    status?: string;
    metadata?: Record<string, string>;
    product?: { id?: string };
    customer?: { id?: string };
  };
  current_period_end_date?: string;
  currentPeriodEndDate?: string;
  canceled_at?: string | null;
  canceledAt?: string | null;
  items?: Array<{ units?: number }>;
};

export type BillingWebhookEvent = {
  id?: string;
  type: string;
  data: WebhookObject;
};

export type BillingWebhookResult = { processed: boolean; duplicate: boolean };
