FROM node:22-alpine AS builder

# Patch Alpine system packages (busybox, zlib CVEs)
RUN apk upgrade --no-cache

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

# Patch Alpine system packages (busybox, zlib CVEs)
RUN apk upgrade --no-cache
# Update npm + patch bundled minimatch 10.2.2 → latest (CVE-2026-27903, CVE-2026-27904)
RUN npm install -g npm@latest \
    && NPM_MM="/usr/local/lib/node_modules/npm/node_modules/minimatch" \
    && cd /tmp && npm pack minimatch@latest 2>/dev/null && tar -xzf minimatch-*.tgz \
    && cp -rf package/* "$NPM_MM/" \
    && rm -rf /tmp/minimatch-* /tmp/package \
    && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

# MCP servers use stdio — no PORT needed
ENTRYPOINT ["node", "dist/index.js"]
