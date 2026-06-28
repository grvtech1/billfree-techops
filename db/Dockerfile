# syntax=docker/dockerfile:1
# Tiny migration runner image — used by docker-compose and the K8s pre-sync Job.
FROM node:20-slim AS runtime
# Patch OS packages in the base image so Trivy-flagged Debian CVEs are cleared.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /db
ENV NODE_ENV=production
COPY db/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY db/migrate.mjs ./
COPY db/migrations ./migrations
# Drop bundled npm from the runtime image (not used at runtime) — removes
# npm-bundled CVEs (e.g. node-tar) and shrinks the attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER node
CMD ["node", "migrate.mjs"]
