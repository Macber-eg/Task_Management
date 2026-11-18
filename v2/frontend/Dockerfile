# syntax=docker/dockerfile:1

# Kaneo v2 web app: a static Vite build served by nginx. The build context is
# this directory:
#   docker build -t kaneo-frontend v2/frontend                      # same origin
#   docker build --build-arg VITE_API_URL=https://api.example.com \
#     -t kaneo-frontend v2/frontend                                 # split hosting
# VITE_API_URL is baked into the bundle; empty means the API is reached at the
# page's own origin. At run time, KANEO_API_UPSTREAM (e.g. http://backend:1337)
# makes nginx proxy /api/ and /.well-known/ to the backend.

FROM node:24.19.0-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# Build inputs only, so editing the nginx files does not rebuild the bundle.
COPY index.html vite.config.ts postcss.config.js components.json tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY i18n ./i18n
COPY public ./public
COPY src ./src
ARG VITE_API_URL=""
# Set even when empty, so it overrides any .env that slipped into the context.
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm build \
  && test -f dist/index.html \
  && find dist -name '*.map' -delete

FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
# Runs as the image's unprivileged nginx user and listens on 8080.
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/api-proxy.conf.template nginx/api-none.conf /etc/nginx/kaneo/
COPY --chmod=755 nginx/40-kaneo-api-proxy.sh /docker-entrypoint.d/40-kaneo-api-proxy.sh
USER root
# Strips CRLF from a Windows checkout and lets the startup script write the
# generated snippet.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-kaneo-api-proxy.sh /etc/nginx/kaneo/* /etc/nginx/conf.d/default.conf \
  && touch /etc/nginx/kaneo/api.conf \
  && chown -R nginx:nginx /etc/nginx/kaneo
USER nginx
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/index.html || exit 1
