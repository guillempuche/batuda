FROM node:24-alpine AS build
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./tsconfig.base.json ./
COPY ./turbo.json ./
RUN sed -i 's/"prepare": "lefthook install"/"prepare": ""/' package.json
COPY ./apps ./apps
COPY ./packages ./packages
RUN --mount=type=cache,target=/root/.pnpm-store CI=true pnpm install --frozen-lockfile
RUN DO_NOT_TRACK=1 TURBO_TELEMETRY_DISABLED=1 pnpm turbo run build --filter=@engranatge/marketing

FROM node:24-alpine
ENV NODE_OPTIONS=--no-network-family-autoselection
WORKDIR /app
COPY --from=build /repo/apps/marketing/.output /app/.output
ENV NODE_ENV=production
ENV PORT=3000
ENV SERVER_URL=https://api.engranatge.com
CMD ["node", ".output/server/index.mjs"]
