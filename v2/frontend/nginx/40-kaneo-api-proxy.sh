#!/bin/sh
# Chooses how nginx handles /api/ and /.well-known/: proxied to
# KANEO_API_UPSTREAM (same-origin layout, e.g. http://backend:1337), or 404
# when it is unset (the API is hosted separately). Run by the nginx image's
# entrypoint before nginx starts.
set -eu

out=/etc/nginx/kaneo/api.conf
upstream="${KANEO_API_UPSTREAM:-}"
upstream="${upstream%/}"

if [ -z "$upstream" ]; then
  cp /etc/nginx/kaneo/api-none.conf "$out"
  echo "kaneo: KANEO_API_UPSTREAM is not set; /api/ is not proxied"
  exit 0
fi

# Scheme, host and optional port only: a path would make nginx rewrite URIs.
if ! printf '%s' "$upstream" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
  echo "kaneo: KANEO_API_UPSTREAM must look like http://host:port, got: $upstream" >&2
  exit 1
fi

# Docker's embedded DNS answers service names directly, so nginx can
# re-resolve them per request. Elsewhere (e.g. Kubernetes, where nginx's
# resolver ignores search domains) the name is resolved once at startup.
if grep -q '^nameserver 127\.0\.0\.11$' /etc/resolv.conf 2>/dev/null; then
  resolver="resolver 127.0.0.11 valid=10s ipv6=off; set \$kaneo_api_upstream $upstream;"
  pass="\$kaneo_api_upstream"
else
  resolver=""
  pass="$upstream"
fi

sed -e "s#__KANEO_API_RESOLVER__#$resolver#" -e "s#__KANEO_API_PASS__#$pass#g" \
  /etc/nginx/kaneo/api-proxy.conf.template > "$out"
echo "kaneo: proxying /api/ and /.well-known/ to $upstream"
