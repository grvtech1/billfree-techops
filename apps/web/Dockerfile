# syntax=docker/dockerfile:1
# ─── Build the React SPA ─────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm ci
# VITE_* are baked in at build time; pass via --build-arg in CI.
# Default to the microservices gateway; nginx proxies /api and /auth to it
# (so VITE_GATEWAY_URL stays empty = relative paths).
ARG VITE_BACKEND="gateway"
ARG VITE_GATEWAY_URL=""
ARG VITE_GAS_URL=""
RUN VITE_BACKEND="$VITE_BACKEND" VITE_GATEWAY_URL="$VITE_GATEWAY_URL" VITE_GAS_URL="$VITE_GAS_URL" \
    npm run build --workspace apps/web

# ─── Serve static assets with rootless Nginx ─────────────────────────────────
# nginx-unprivileged runs as UID 101 and listens on 8080 (no root, no
# NET_BIND_SERVICE). It writes its pid/temp under /tmp + /var/cache/nginx, which
# the Helm values mount as emptyDir so the container can keep a read-only rootfs.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
