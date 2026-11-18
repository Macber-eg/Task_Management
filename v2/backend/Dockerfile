# syntax=docker/dockerfile:1

# Kaneo v2 backend (NestJS + TypeORM). The build context is this directory:
#   docker build -t kaneo-backend v2/backend
# Every setting comes from the environment at run time (see .env.example);
# migrations run on startup, before the server listens.

ARG NODE_IMAGE=node:24.19.0-alpine

FROM ${NODE_IMAGE} AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
# The manifests only, so dependency layers are reused until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY nest-cli.json tsconfig.json tsconfig.build.json .swcrc ./
COPY src ./src
# `nest build` compiles with SWC and copies the `**/*.sql` assets, including
# the baseline migration's `database/migrations/baseline.sql`.
RUN pnpm build \
  && test -f dist/main.js \
  && test -f dist/database/migrations/baseline.sql \
  && find dist -name '*.map' -delete

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
  PORT=1337
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The image's built-in unprivileged `node` user (uid 1000). The app writes
# nothing to disk; files go to S3.
USER node
EXPOSE 1337
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -Y off -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "dist/main.js"]
