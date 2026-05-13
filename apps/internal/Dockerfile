# Stage 1 — build
FROM node:24-alpine AS build

# Disable parallel IPv4/IPv6 — required for Unikraft's network stack
ENV NODE_OPTIONS=--no-network-family-autoselection

WORKDIR /repo

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

# Copy workspace manifests first for layer caching
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./tsconfig.base.json ./
COPY ./turbo.json ./

# Disable lefthook in Docker build (no git available)
RUN sed -i 's/"prepare": "lefthook install"/"prepare": ""/' package.json

COPY ./apps ./apps
COPY ./packages ./packages

RUN --mount=type=cache,target=/root/.pnpm-store \
    CI=true pnpm install --frozen-lockfile

# Baked into the Vite client+SSR bundles via `import.meta.env.VITE_SERVER_URL`
# (see apps/internal/src/lib/api-base.ts). Vite replaces this statically at
# build time, so setting it at runtime would be too late — without it the SSR
# session check resolves an empty base URL and every request lands on /login.
ENV VITE_SERVER_URL=https://api.batuda.co

RUN DO_NOT_TRACK=1 TURBO_TELEMETRY_DISABLED=1 \
    pnpm turbo run build --filter=@batuda/internal

# Stage 2 — runtime (production-only, no devDependencies or source)
FROM node:24-alpine

ENV NODE_OPTIONS=--no-network-family-autoselection
ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root for security
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

WORKDIR /app

# Copy only the Nitro-bundled output — fully self-contained, no node_modules
COPY --from=build --chown=app:app /repo/apps/internal/.output /app/.output

USER app

CMD ["node", ".output/server/index.mjs"]
