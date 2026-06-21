# syntax=docker/dockerfile:1
FROM node:20-slim AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/auth-service ./services/auth-service
RUN npm ci
RUN npm run build --workspace services/auth-service

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY services/auth-service/package.json ./
RUN npm pkg delete dependencies.@billfree/shared dependencies.@billfree/service-common \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=builder /repo/services/auth-service/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
