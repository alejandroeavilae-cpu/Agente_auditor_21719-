# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Imágenes de la plataforma (multi-etapa). Objetivos:
#   - api: API NestJS en Node.js 24, usuario sin privilegios, solo dependencias de producción.
#   - web: SPA compilada servida por Caddy, que además actúa como proxy inverso hacia la API.
# Las imágenes base se fijan por digest (P-13). Para actualizarlas, use los digests que
# registra el job de CI "Registrar digests" y verifique que el escaneo D-24 siga en verde.

ARG NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
ARG GO_IMAGE=golang:1.27-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c
ARG ALPINE_IMAGE=alpine:3.23@sha256:ff7f0c727dd796aa36787bfcd9a64bf35a6ce72a73451b3359fde849b6703d63

# ---------- Etapa de compilación (común) ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
# corepack instala la versión exacta de pnpm declarada en package.json ("packageManager").
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/audit-log/package.json packages/audit-log/
# --frozen-lockfile: la compilación falla si el lockfile no coincide (versiones fijadas, sección 15.4).
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm --filter @auditor-21719/api --filter @auditor-21719/web run build \
 && pnpm --filter @auditor-21719/api deploy --prod --legacy /out/api

# ---------- Compilación de Caddy (proxy inverso) ----------
FROM ${GO_IMAGE} AS caddy-build
ARG CADDY_VERSION=v2.11.7
WORKDIR /build
COPY deploy/docker/caddy-build/main.go ./
# Se fuerza x/net a una versión corregida (vulnerabilidad alta en v0.59.0, D-24).
RUN go mod init auditor21719/caddy \
 && go get github.com/caddyserver/caddy/v2@${CADDY_VERSION} golang.org/x/net@v0.60.0 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/caddy .

# ---------- API ----------
FROM ${NODE_IMAGE} AS api
ARG BUILD_COMMIT=desarrollo
ARG BUILD_VERSION=0.1.0
ENV NODE_ENV=production \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_VERSION=${BUILD_VERSION} \
    PORT=3000
WORKDIR /app
# El runtime no necesita gestores de paquetes: se eliminan npm, corepack y yarn
# (reducen superficie de ataque y arrastraban dependencias vulnerables, D-24) y se
# actualizan los paquetes del sistema base.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Archivos propiedad de root y solo lectura para el usuario de ejecución:
# un proceso comprometido no puede modificar el código que ejecuta.
COPY --from=build /out/api ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

# ---------- Web + proxy inverso ----------
FROM ${ALPINE_IMAGE} AS web
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates
COPY --from=caddy-build /out/caddy /usr/bin/caddy
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
# Caddy escucha en 8080 (puerto no privilegiado) y se ejecuta con un usuario sin privilegios.
USER 65532:65532
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
