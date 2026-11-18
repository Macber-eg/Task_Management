/**
 * Where tools call the REST API: `KANEO_INTERNAL_API_URL`, else this
 * server itself over loopback on the port the request arrived on. Either
 * way without the `/api` suffix, which tool paths carry.
 */
export function internalApiUrl(localPort: number | undefined): string {
  const configured =
    process.env.KANEO_INTERNAL_API_URL ||
    `http://127.0.0.1:${localPort ?? (Number(process.env.PORT) || 1337)}`;
  return configured.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}
