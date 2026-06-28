# syntax=docker/dockerfile:1
FROM node:20-slim AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/auth-service ./services/auth-service
RUN npm ci
RUN npm run build --workspace services/auth-service

FROM node:20-slim AS runtime
# Patch OS packages in the base image so Trivy-flagged Debian CVEs are cleared.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY services/auth-service/package.json ./
RUN npm pkg delete dependencies.@billfree/shared dependencies.@billfree/service-common \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=builder /repo/services/auth-service/dist ./dist
# Drop bundled npm from the runtime image (not used at runtime) — removes
# npm-bundled CVEs (e.g. node-tar) and shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
