const DEFAULT_CLIENT_IDS = ["kaneo-cli", "kaneo-mcp"];

/** The clients allowed to start a device login (`DEVICE_AUTH_CLIENT_IDS`). */
export function isAllowedDeviceClient(clientId: string): boolean {
  const raw = process.env.DEVICE_AUTH_CLIENT_IDS?.trim();
  const allowed = raw
    ? raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : DEFAULT_CLIENT_IDS;
  return allowed.includes(clientId);
}
