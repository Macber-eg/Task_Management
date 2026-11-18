type AnalyticsSettings = {
  plausibleDomain: string;
  scriptUrl: string;
} | null;

let loaded = false;

/**
 * Adds the Plausible script when the backend config enables analytics. Events
 * sent before the script arrives are queued, as Plausible's snippet does.
 */
export function loadPlausible(settings: AnalyticsSettings | undefined) {
  if (loaded || !settings?.plausibleDomain || !settings.scriptUrl) return;
  loaded = true;

  const queued: unknown[][] = [];
  const queue = (...args: unknown[]) => {
    queued.push(args);
  };
  window.plausible ??= Object.assign(queue, { q: queued });

  const script = document.createElement("script");
  script.defer = true;
  script.dataset.domain = settings.plausibleDomain;
  script.src = settings.scriptUrl;
  document.head.appendChild(script);
}
