const SAFE_CODE = /^['A-Za-z0-9_-]+$/;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type OAuthErrorPage =
  | { redirect: string; html?: undefined }
  | { html: string; redirect?: undefined };

/**
 * `GET /error`, where an OAuth flow that named no error page of its own
 * ends. In production the browser is sent to the site root with the error in
 * the query, as before; elsewhere a bare page shows it.
 */
export function oauthErrorPage(query: URLSearchParams): OAuthErrorPage {
  const rawCode = query.get("error") || "UNKNOWN";
  const code = SAFE_CODE.test(rawCode) ? rawCode : "UNKNOWN";
  const description = query.get("error_description") || null;

  if (process.env.NODE_ENV === "production") {
    const params = new URLSearchParams({ error: code });
    if (description) params.set("error_description", description);
    return { redirect: `/?${params.toString()}` };
  }

  const detail = description ? `<p>${escapeHtml(description)}</p>` : "";
  return {
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Error</title>
  </head>
  <body>
    <h1>Sign-in failed</h1>
    <p><code>${escapeHtml(code)}</code></p>
    ${detail}
  </body>
</html>`,
  };
}
