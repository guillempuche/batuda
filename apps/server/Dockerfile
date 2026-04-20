# Stage 1 — build
FROM node:24-alpine AS build

# Disable parallel IPv4/IPv6 — required for Unikraft's network stack
ENV NODE_OPTIONS=--no-network-family-autoselection

WORKDIR /repo

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./tsconfig.base.json ./

# Disable lefthook in Docker build (no git available)
RUN sed -i 's/"prepare": "lefthook install"/"prepare": ""/' package.json

COPY ./apps/server ./apps/server
COPY ./packages ./packages

RUN --mount=type=cache,target=/root/.pnpm-store \
    CI=true pnpm install --frozen-lockfile

RUN pnpm --filter @batuda/domain build && \
    pnpm --filter @batuda/server build

# Stage 2 — runtime (production-only, no devDependencies or source)
FROM node:24-alpine

ENV NODE_OPTIONS=--no-network-family-autoselection
ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root for security
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

WORKDIR /app

COPY --from=build --chown=app:app /repo/apps/server/dist /app/dist

USER app

CMD ["node", "dist/main.mjs"]
