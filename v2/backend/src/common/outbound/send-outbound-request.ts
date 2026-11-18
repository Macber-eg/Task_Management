import { assertPublicDestination } from "./assert-public-destination";
import { OutboundRequestError } from "./outbound-request-error";
import { readSmallJson } from "./read-small-json";
import { withoutOutboundTelemetry } from "./sensitive-outbound";

/**
 * POSTs to a user-configured destination: bounded by a deadline that covers
 * DNS validation, headers and body, never following redirects, and failing
 * with an `OutboundRequestError` that carries no URL, header or body.
 */
export async function sendOutboundRequest(
  url: string,
  init: Pick<RequestInit, "headers" | "body">,
  options: {
    readJson?: boolean;
    publicDestination?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OutboundRequestError("timeout"));
    }, options.timeoutMs ?? 10_000);
  });
  const request = async () => {
    if (options.publicDestination) {
      try {
        await assertPublicDestination(url, "Notification");
      } catch {
        throw new OutboundRequestError("destination");
      }
    }
    // DNS validation may finish after the deadline. Never start a late request.
    controller.signal.throwIfAborted();
    const response = await withoutOutboundTelemetry(() =>
      fetch(url, {
        ...init,
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      }),
    );
    if (!response.ok || !options.readJson) {
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw new OutboundRequestError("http", response.status);
      return undefined;
    }
    return readSmallJson(response);
  };
  try {
    return await Promise.race([request(), deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw new OutboundRequestError("timeout");
    if (error instanceof OutboundRequestError) throw error;
    throw new OutboundRequestError("network");
  } finally {
    clearTimeout(timer);
  }
}
