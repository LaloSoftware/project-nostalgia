# syntax=docker/dockerfile:1
#
# Etapa 1 (ver docs/decisiones/0011-servidor-docker-lan-para-pruebas-multidispositivo.md):
# imagen para servir el build estático de Nostalgia por HTTP plano dentro de la LAN local.
# El motor de audio nativo (Tauri/cpal) NUNCA corre aquí — este contenedor solo sirve los
# archivos estáticos generados por `pnpm build`; el audio real lo captura el navegador
# cliente vía `WebAudioEngine` (ver app/src/core/engine-web.ts).

# --- Stage 1: builder ---
# node:22-alpine iguala la major activa del entorno de desarrollo (v22.20.0 al escribir esto).
# Verificar contra `node -v` local si el equipo cambia de major en el futuro.
FROM node:22-alpine AS builder
WORKDIR /build

# corepack fija la versión exacta de pnpm declarada en package.json (packageManager),
# igual que en desarrollo local — ver docs/decisiones/0007-dependencias-y-cadena-de-suministro.md.
RUN corepack enable

# Copiar solo los manifiestos primero: aprovecha la cache de capas de Docker — si
# package.json/pnpm-lock.yaml no cambian, no se reinstala en cada build.
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare --activate && pnpm install --frozen-lockfile

# Ahora el resto del código fuente (src-tauri/ queda fuera vía .dockerignore: pnpm build
# no lo toca en absoluto).
COPY . .
RUN pnpm build

# --- Stage 2: runtime ---
# Caddy en vez de nginx: la Etapa 2 (HTTPS con CA local) usa `tls internal`, una directiva
# nativa de Caddy que emite y renueva certificados sin herramientas externas (mkcert/step-ca).
# Ver la comparación completa en el ADR 0011.
FROM caddy:2.9-alpine AS runtime
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /build/dist /srv
EXPOSE 80
