FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=/api
ARG APP_VERSION=0.0.0
ARG APP_BUILD_ID=dev-local
ARG APP_BUILD_TIME=1970-01-01T00:00:00.000Z
ARG GIT_COMMIT=unknown
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_APP_VERSION=${APP_VERSION}
ENV VITE_BUILD_ID=${APP_BUILD_ID}
ENV VITE_BUILD_TIME=${APP_BUILD_TIME}
ENV VITE_COMMIT_SHA=${GIT_COMMIT}

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

COPY public ./public
COPY src ./src
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./

RUN npm run build

FROM docker.io/library/nginx:1.27-alpine AS runner

ARG APP_VERSION=0.0.0
ARG APP_BUILD_ID=dev-local
ARG APP_BUILD_TIME=1970-01-01T00:00:00.000Z
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.created="${APP_BUILD_TIME}"
LABEL org.opencontainers.image.title="behebes-ai-ops"

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
