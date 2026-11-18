import { Injectable } from "@nestjs/common";
import type { IssueField } from "../links/deferred-issue-edit";

/** A linked issue as the provider answers it (title, raw body, state). */
export type DeferredEditIssue = {
  title: string;
  body?: string | null;
  state: string;
  updated_at?: string;
};

/**
 * Reads and writes one linked issue for the deferred-edit replay. `write`
 * sets a single field (`description` is the task text; the provider adds its
 * footer) and answers the provider's `updated_at`. A read of a deleted issue
 * must reject with an error whose `status` is 404.
 */
export type DeferredEditAccess = {
  read(): Promise<DeferredEditIssue>;
  write(field: IssueField, value: string): Promise<string | undefined>;
};

export type DeferredEditAccessFactory = (
  integration: { type: string; config: string },
  link: { externalId: string; taskId: string },
) => Promise<DeferredEditAccess>;

/**
 * The git providers whose deferred issue edits the replay job processes,
 * keyed by `integration.type`. A provider registers in its plugin's
 * `onModuleInit`; links of an unregistered type have their job dropped, as
 * the previous backend did for anything but GitHub and Gitea.
 */
@Injectable()
export class DeferredIssueEditProviders {
  private readonly providers = new Map<string, DeferredEditAccessFactory>();

  register(type: string, open: DeferredEditAccessFactory): void {
    if (this.providers.has(type)) {
      throw new Error(`Deferred issue edits for ${type} already registered`);
    }
    this.providers.set(type, open);
  }

  get(type: string): DeferredEditAccessFactory | undefined {
    return this.providers.get(type);
  }
}
