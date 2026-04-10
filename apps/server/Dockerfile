# Stage 1 — build
FROM node:24-alpine AS build

# Disable parallel IPv4/IPv6 — required for Unikraft's network stack
ENV NODE_OPTIONS=--no-network-family-autoselection

WORKDIR /repo

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./tsconfig.base.json ./
COPY ./apps/server ./apps/server
COPY ./packages ./packages

RUN --mount=type=cache,target=/root/.pnpm-store \
    CI=true pnpm install --frozen-lockfile

RUN pnpm --filter @engranatge/domain build && \
    pnpm --filter @engranatge/server build

# Stage 2 — runtime
FROM node:24-alpine

ENV NODE_OPTIONS=--no-network-family-autoselection
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app
COPY --from=build /repo/apps/server/dist /app/dist

CMD ["node", "dist/main.mjs"]
