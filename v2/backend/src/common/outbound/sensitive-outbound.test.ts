import { expect, it } from "vitest";
import {
  isSensitiveOutboundRequest,
  withoutOutboundTelemetry,
} from "./sensitive-outbound";

it("isolates sensitive delivery context from concurrent ordinary requests", async () => {
  let release!: () => void;
  const wait = new Promise<void>((done) => {
    release = done;
  });
  const sensitive = withoutOutboundTelemetry(async () => {
    expect(isSensitiveOutboundRequest()).toBe(true);
    await wait;
    expect(isSensitiveOutboundRequest()).toBe(true);
  });
  expect(isSensitiveOutboundRequest()).toBe(false);
  release();
  await sensitive;
  expect(isSensitiveOutboundRequest()).toBe(false);
});

it.skip("keeps credentials out of actual Sentry events, breadcrumbs and spans while retaining ordinary HTTP telemetry (needs Sentry instrumentation, which is not ported yet)", () => {});
