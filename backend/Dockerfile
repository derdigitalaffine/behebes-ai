FROM node:22-alpine AS builder

WORKDIR /app

ARG APP_VERSION=0.0.0
ARG APP_BUILD_ID=dev-local
ARG APP_BUILD_TIME=1970-01-01T00:00:00.000Z
ARG GIT_COMMIT=unknown

# Native build tools (e.g. sqlite3) for dependency install
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN set -eux; \
    install_cmd='if [ -f package-lock.json ]; then npm ci --no-audit --fund=false --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=120000 --fetch-timeout=180000; else npm install --no-audit --fund=false --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=120000 --fetch-timeout=180000; fi'; \
    attempt=1; \
    until [ "$attempt" -gt 4 ]; do \
      echo "npm dependency install attempt ${attempt}/4"; \
      if sh -lc "$install_cmd"; then \
        break; \
      fi; \
      if [ "$attempt" -eq 4 ]; then \
        echo "npm dependency install failed after ${attempt} attempts"; \
        exit 1; \
      fi; \
      echo "npm dependency install failed (attempt ${attempt}); retrying after backoff"; \
      npm cache verify || true; \
      sleep "$((attempt * 10))"; \
      attempt="$((attempt + 1))"; \
    done

COPY tsconfig.json ./
COPY src ./src
COPY config ./config
COPY knowledge ./knowledge
COPY templates ./templates

RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ARG APP_VERSION=0.0.0
ARG APP_BUILD_ID=dev-local
ARG APP_BUILD_TIME=1970-01-01T00:00:00.000Z
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV APP_BUILD_ID=${APP_BUILD_ID}
ENV APP_BUILD_TIME=${APP_BUILD_TIME}
ENV GIT_COMMIT=${GIT_COMMIT}
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.created="${APP_BUILD_TIME}"
LABEL org.opencontainers.image.title="behebes-ai-backend"

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/knowledge ./knowledge
COPY --from=builder /app/templates ./templates

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["npm", "start"]
