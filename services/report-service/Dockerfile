# syntax=docker/dockerfile:1
# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:26-slim AS builder
WORKDIR /repo

# Install with the root lockfile (workspaces) for reproducible builds.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/report-service ./services/report-service
RUN npm ci

# Bundle the service (+ @billfree/* workspace deps) into dist/index.js.
RUN npm run build --workspace services/report-service

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only the external runtime deps are needed (workspace pkgs are bundled in dist).
COPY services/report-service/package.json ./
RUN npm pkg delete dependencies.@billfree/shared dependencies.@billfree/service-common \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=builder /repo/services/report-service/dist ./dist

# Run as the unprivileged built-in node user.
USER node
EXPOSE 8080
# Liveness/readiness handled by K8s probes hitting /healthz and /readyz.
CMD ["node", "dist/index.js"]
