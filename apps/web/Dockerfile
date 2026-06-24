# syntax=docker/dockerfile:1
# ─── Build the React SPA ─────────────────────────────────────────────────────
FROM node:26-slim AS builder
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

# ─── Serve static assets with Nginx ──────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
