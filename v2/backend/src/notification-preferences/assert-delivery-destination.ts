import { HTTPException } from "../common/errors/http-exception";
import { assertPublicDestination } from "../common/outbound/assert-public-destination";

/**
 * 400 unless the URL parses and is a public http(s) destination. The
 * previous backend reused the generic webhook's check here, so its messages
 * name "Generic webhook" whichever channel is being saved.
 */
export async function assertDeliveryDestination(
  url: string,
  fallbackMessage: string,
): Promise<void> {
  try {
    new URL(url);
    await assertPublicDestination(url, "Generic webhook");
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : fallbackMessage,
    });
  }
}
