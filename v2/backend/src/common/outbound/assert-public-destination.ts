import { lookup } from "node:dns/promises";
import { isDisallowedAddress } from "./disallowed-address";

export function privateDestinationsAllowed(): boolean {
  return (
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "true" ||
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS === "1"
  );
}

export function nonRoutableDestinationMessage(label: string): string {
  return `${label} destination resolves to a non-routable address`;
}

/**
 * Refuses a URL that is not http(s) or whose host is, or resolves to, a
 * non-routable address, unless `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` is
 * set. `label` prefixes the error messages, which callers show to users.
 */
export async function assertPublicDestination(
  destinationUrl: string,
  label: string,
): Promise<void> {
  const url = new URL(destinationUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} URL must use http or https`);
  }

  if (privateDestinationsAllowed()) {
    return;
  }

  if (isDisallowedAddress(url.hostname)) {
    throw new Error(nonRoutableDestinationMessage(label));
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`${label} destination could not be resolved`);
  }

  if (addresses.some((entry) => isDisallowedAddress(entry.address))) {
    throw new Error(nonRoutableDestinationMessage(label));
  }
}
