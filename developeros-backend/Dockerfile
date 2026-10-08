# syntax=docker/dockerfile:1
# DeveloperOS API + static UI. One image serves two roles:
#   - app:     `node server.js`        (DATABASE_URL = unprivileged runtime role)
#   - migrate: `npm run db:migrate`    (MIGRATION_DATABASE_URL = schema owner)
# Build:  docker build -t developeros:local .
#         (mirror: --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim)
ARG NODE_IMAGE=node:22-bookworm-slim

# ── deps: production dependencies only, from the lockfile ─────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Behind a TLS-intercepting egress proxy, pass its CA as a build secret
# (never baked into the image) plus the standard HTTPS_PROXY build arg:
#   docker build --secret id=npm_ca,src=/path/ca.crt --build-arg HTTPS_PROXY=... .
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

# ── runtime ───────────────────────────────────────────────────
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app

# Application files stay root-owned and read-only for the service user;
# only logs/ (morgan access log in production) is writable.
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /app/logs && chown node:node /app/logs

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
CMD ["node", "server.js"]
