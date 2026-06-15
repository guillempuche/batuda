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

# Disable lefthook in the Docker build (no git here); match any prepare value so a
# later prepare-script change can't silently slip past and break the build.
RUN sed -i 's/"prepare": "[^"]*"/"prepare": ""/' package.json

# Copy the full workspace so the turbo filter has the complete graph.
# @batuda/mail-worker transitively depends on auth, calendar, controllers,
# domain, email, research, ui — turbo's `^build` resolves them all.
COPY ./apps ./apps
COPY ./packages ./packages

RUN --mount=type=cache,target=/root/.pnpm-store \
    CI=true pnpm install --frozen-lockfile

RUN DO_NOT_TRACK=1 TURBO_TELEMETRY_DISABLED=1 \
    pnpm turbo run build --filter=@batuda/mail-worker

# Produce a self-contained deploy tree (app dist + flattened prod
# node_modules). tsdown externalizes `dependencies` by default, so the
# runtime image needs real node_modules — bundling alone is not enough.
RUN pnpm deploy --filter=@batuda/mail-worker --prod /deploy

# Stage 2 — runtime (production-only, no devDependencies or source)
FROM node:24-alpine

ENV NODE_OPTIONS=--no-network-family-autoselection
ENV NODE_ENV=production

# Run as non-root for security
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

WORKDIR /app

COPY --from=build --chown=app:app /deploy /app

USER app

CMD ["node", "dist/main.mjs"]
