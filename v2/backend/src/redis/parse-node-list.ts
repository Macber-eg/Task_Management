export type RedisNode = { host: string; port: number };

function parseEntry(
  entry: string,
  envName: string,
  defaultPort: number,
): RedisNode {
  let host: string;
  let portStr: string | undefined;

  if (entry.startsWith("[")) {
    // IPv6 bracket notation: [::1]:6379
    const closingBracket = entry.indexOf("]");
    if (closingBracket === -1) {
      throw new Error(
        `Invalid entry "${entry}" in ${envName}: missing closing bracket for IPv6 address`,
      );
    }
    host = entry.slice(1, closingBracket);
    const afterBracket = entry.slice(closingBracket + 1);
    if (afterBracket.startsWith(":")) {
      portStr = afterBracket.slice(1);
    } else if (afterBracket.length > 0) {
      throw new Error(
        `Invalid entry "${entry}" in ${envName}: unexpected characters after IPv6 address`,
      );
    }
  } else {
    const colonCount = entry.split(":").length - 1;
    if (colonCount > 1) {
      // A bare IPv6 address without brackets, e.g. "::1".
      host = entry;
    } else if (colonCount === 1) {
      const colonIdx = entry.indexOf(":");
      host = entry.slice(0, colonIdx);
      portStr = entry.slice(colonIdx + 1);
    } else {
      host = entry;
    }
  }

  if (!host) {
    throw new Error(`Invalid entry "${entry}" in ${envName}: host is missing`);
  }
  const port = portStr ? Number(portStr) : defaultPort;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Invalid entry "${entry}" in ${envName}: port must be a number between 1 and 65535`,
    );
  }
  return { host, port };
}

/** Parses a comma-separated `host:port` list such as `REDIS_CLUSTER_NODES`. */
export function parseNodeList(
  raw: string,
  envName: string,
  defaultPort: number,
): RedisNode[] {
  const nodes = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseEntry(entry, envName, defaultPort));

  if (nodes.length === 0) {
    throw new Error(`${envName} is set but contains no valid entries`);
  }

  return nodes;
}
