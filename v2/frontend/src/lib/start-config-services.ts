import type { QueryClient } from "@tanstack/react-query";
import { getConfig } from "@/fetchers/config/get-config";
import { initSentry } from "@/instrument";
import { loadPlausible } from "@/lib/analytics/load-plausible";

/**
 * Error reporting and analytics are configured on the backend: load the
 * public config once (into the cache `useGetConfig` reads) and start them.
 * Without a reachable backend or settings, both simply stay off.
 */
export function startConfigServices(queryClient: QueryClient) {
  queryClient
    .fetchQuery({ queryKey: ["config"], queryFn: getConfig })
    .then((config) => {
      initSentry(config);
      loadPlausible(config.analytics);
    })
    .catch(() => {});
}
