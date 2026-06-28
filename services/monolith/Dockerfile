# syntax=docker/dockerfile:1
# Modular monolith — bundles auth/tickets/analytics/calllog/reports into one
# process. The build needs every workspace package it composes.
FROM node:20-slim AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci
RUN npm run build --workspace services/monolith

FROM node:20-slim AS runtime
# Patch OS packages in the base image so Trivy-flagged Debian CVEs are cleared.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY services/monolith/package.json ./
# Strip workspace deps (bundled into dist by tsup) and install only the external
# runtime deps the bundle requires.
RUN npm pkg delete \
      dependencies.@billfree/service-common \
      dependencies.@billfree/auth-service \
      dependencies.@billfree/ticket-service \
      dependencies.@billfree/analytics-service \
      dependencies.@billfree/calllog-service \
      dependencies.@billfree/report-service \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=builder /repo/services/monolith/dist ./dist
# Drop bundled npm from the runtime image (not used at runtime) — removes
# npm-bundled CVEs (e.g. node-tar) and shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
