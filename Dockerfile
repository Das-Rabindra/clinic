# ─────────────────────────────────────────────────────────────────────────────
# Samal Dental Care — production image
#
# Multi-stage: native modules (sharp) are compiled in a builder with a full
# toolchain, then only the resulting node_modules and application source are
# copied into a slim runtime. Runs as the unprivileged `node` user.
#
# State lives in PostgreSQL, so the only volume is uploads (and even that is
# unnecessary when STORAGE_DRIVER=blob).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps

# Build toolchain for any native module without a prebuilt binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./

# Install production dependencies only; the app has no build/bundling step.
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# tini reaps zombies and forwards SIGTERM so shutdown stays clean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8090 \
    UPLOAD_DIR=/uploads \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Writable volumes for the database and uploaded media. Owned by `node` so the
# process never needs root.
RUN mkdir -p /uploads && chown -R node:node /uploads /app

USER node

EXPOSE 8090
VOLUME ["/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
