# syntax=docker/dockerfile:1
# The MinIO server, built from the binary MinIO signs and attaches to its own
# GitHub release. MinIO's registries (quay.io, Docker Hub) refuse every pull
# since October 2026, so the stack runs this copy instead, published to this
# project's registry for the amd64 runners CI uses and the arm64 laptops.
# The binary's published checksum is verified on download; that file names the
# binary without its platform, so the hash is read off it and checked by hand.
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -f docker/minio.Dockerfile -t ghcr.io/guillempuche/minio:<release> --push docker
ARG RELEASE=RELEASE.2025-09-07T16-13-09Z

FROM alpine:3.21 AS fetch
ARG RELEASE
ARG TARGETARCH
RUN apk add --no-cache curl
WORKDIR /fetch
RUN curl -fsSL -O "https://github.com/minio/minio/releases/download/${RELEASE}/minio.linux-${TARGETARCH}.${RELEASE}" \
	&& curl -fsSL -O "https://github.com/minio/minio/releases/download/${RELEASE}/minio.linux-${TARGETARCH}.${RELEASE}.sha256sum" \
	&& echo "$(cut -d' ' -f1 "minio.linux-${TARGETARCH}.${RELEASE}.sha256sum")  minio.linux-${TARGETARCH}.${RELEASE}" | sha256sum -c - \
	&& mv "minio.linux-${TARGETARCH}.${RELEASE}" /minio \
	&& chmod +x /minio

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=fetch /minio /usr/bin/minio
EXPOSE 9000 9001
VOLUME /data
ENTRYPOINT ["minio"]
