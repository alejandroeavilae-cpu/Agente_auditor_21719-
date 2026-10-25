# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Imágenes de la plataforma (multi-etapa). Objetivos:
#   - api: API NestJS en Node.js 24, usuario sin privilegios, solo dependencias de producción.
#   - web: SPA compilada servida por Caddy, que además actúa como proxy inverso hacia la API.
# Las imágenes base se fijan por versión aquí y por digest en CI (ver docs/fase-1).

ARG NODE_IMAGE=node:24-alpine
ARG CADDY_IMAGE=caddy:2-alpine

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

# ---------- API ----------
FROM ${NODE_IMAGE} AS api
ARG BUILD_COMMIT=desarrollo
ARG BUILD_VERSION=0.1.0
ENV NODE_ENV=production \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_VERSION=${BUILD_VERSION} \
    PORT=3000
WORKDIR /app
# Archivos propiedad de root y solo lectura para el usuario de ejecución:
# un proceso comprometido no puede modificar el código que ejecuta.
COPY --from=build /out/api ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

# ---------- Web + proxy inverso ----------
FROM ${CADDY_IMAGE} AS web
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
# Caddy escucha en 8080 (puerto no privilegiado) y se ejecuta con un usuario sin privilegios.
USER 65532:65532
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
EXPOSE 8080
