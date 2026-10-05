# syntax=docker/dockerfile:1
# MinIO's command-line client, built from the binary MinIO signs and attaches to
# its own GitHub release, for the same reason as docker/minio.Dockerfile. The
# bucket-creating sidecar and the worktree commands run `mc` from this image.
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -f docker/mc.Dockerfile -t ghcr.io/guillempuche/mc:<release> --push docker
ARG RELEASE=RELEASE.2025-08-13T08-35-41Z

FROM alpine:3.21 AS fetch
ARG RELEASE
ARG TARGETARCH
RUN apk add --no-cache curl
WORKDIR /fetch
RUN curl -fsSL -O "https://github.com/minio/mc/releases/download/${RELEASE}/mc.linux-${TARGETARCH}.${RELEASE}" \
	&& curl -fsSL -O "https://github.com/minio/mc/releases/download/${RELEASE}/mc.linux-${TARGETARCH}.${RELEASE}.sha256sum" \
	&& echo "$(cut -d' ' -f1 "mc.linux-${TARGETARCH}.${RELEASE}.sha256sum")  mc.linux-${TARGETARCH}.${RELEASE}" | sha256sum -c - \
	&& mv "mc.linux-${TARGETARCH}.${RELEASE}" /mc \
	&& chmod +x /mc

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=fetch /mc /usr/bin/mc
ENTRYPOINT ["mc"]
