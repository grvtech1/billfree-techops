# syntax=docker/dockerfile:1
FROM node:20-slim AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/api-gateway ./services/api-gateway
RUN npm ci
RUN npm run build --workspace services/api-gateway

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY services/api-gateway/package.json ./
RUN npm pkg delete dependencies.@billfree/shared dependencies.@billfree/service-common \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=builder /repo/services/api-gateway/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
