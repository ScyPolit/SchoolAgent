# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY third_party/librechat-latest ./third_party/librechat-latest
COPY upstream/LibreChat ./upstream/LibreChat
RUN npm run install:client && npm run build

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 schoolagent && useradd --uid 10001 --gid schoolagent --create-home schoolagent
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/school-agent.sqlite \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    XDG_CONFIG_HOME=/tmp/schoolagent-chromium/config \
    XDG_CACHE_HOME=/tmp/schoolagent-chromium/cache
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY third_party ./third_party
RUN mkdir -p /app/data /app/backups && chown -R schoolagent:schoolagent /app/data /app/backups
USER schoolagent
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/start.js"]
