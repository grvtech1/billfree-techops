# syntax=docker/dockerfile:1
# Tiny migration runner image — used by docker-compose and the K8s pre-sync Job.
FROM node:26-slim AS runtime
WORKDIR /db
ENV NODE_ENV=production
COPY db/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY db/migrate.mjs ./
COPY db/migrations ./migrations
USER node
CMD ["node", "migrate.mjs"]
