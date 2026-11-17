# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24-bookworm-slim
ARG GO_IMAGE=golang:1.27.4-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-build
WORKDIR /app
RUN npm install --global pnpm@9.7.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS go-build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY plugins ./plugins
COPY shared ./shared
COPY migrations ./migrations
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/markvault ./cmd/markvault \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/markvault-migrate ./cmd/markvault-migrate

FROM ${RUNTIME_IMAGE} AS deno-build
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && case "$TARGETARCH" in \
      amd64) asset=x86_64; digest=e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609 ;; \
      arm64) asset=aarch64; digest=d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905 ;; \
      *) exit 1 ;; esac \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/v2.9.8/deno-${asset}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && echo "$digest  /tmp/deno.zip" | sha256sum -c - \
    && unzip /tmp/deno.zip -d /out

FROM ${RUNTIME_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 markvault \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin markvault \
    && mkdir -p /app /data \
    && chown markvault:markvault /app /data
WORKDIR /app
ENV PORT=8787 \
    MARKVAULT_DATA_DIR=/data \
    MARKVAULT_WEB_DIR=/app/dist \
    ENVIRONMENT=production
COPY --from=go-build /out/markvault /out/markvault-migrate /app/
COPY --from=deno-build /out/deno /usr/local/bin/deno
COPY --from=web-build --chown=1000:1000 /app/dist /app/dist
USER 1000:1000
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/app/markvault", "-healthcheck"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/markvault"]
