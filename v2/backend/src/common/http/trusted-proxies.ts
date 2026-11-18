import { BlockList, isIP } from "node:net";

const DEFAULT_TRUSTED_PROXIES = "127.0.0.0/8,::1/128";
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function unmapIpv4(address: string): string {
  return IPV4_MAPPED.exec(address)?.[1] ?? address;
}

/**
 * Which peers may report the client's address in `X-Forwarded-For`, from
 * `TRUSTED_PROXIES` (comma-separated IPs or CIDR ranges, or `none`).
 * Defaults to loopback, for a reverse proxy on the same host. The result is
 * Express's `trust proxy` setting, so `request.ip` is the real client
 * behind trusted hops and the transport peer otherwise.
 */
export function trustedProxyMatcher(
  config = process.env.TRUSTED_PROXIES,
): (address: string) => boolean {
  const trusted = new BlockList();
  const raw = config?.trim() || DEFAULT_TRUSTED_PROXIES;
  for (const entry of raw === "none" ? [] : raw.split(",")) {
    const parts = entry.trim().split("/");
    const [address = "", prefix] = parts;
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    if (
      !family ||
      parts.length > 2 ||
      (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > bits))
    ) {
      throw new Error(
        "TRUSTED_PROXIES must contain valid IP addresses or CIDR ranges, or 'none'",
      );
    }
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) trusted.addAddress(address, type);
    else trusted.addSubnet(address, Number(prefix), type);
  }

  return (address: string) => {
    const normalized = unmapIpv4(address);
    const family = isIP(normalized);
    if (!family) return false;
    return trusted.check(normalized, family === 4 ? "ipv4" : "ipv6");
  };
}
