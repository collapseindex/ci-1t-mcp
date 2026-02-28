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
# Update npm to fix bundled tar/minimatch/glob CVEs
RUN npm install -g npm@latest && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

# MCP servers use stdio — no PORT needed
ENTRYPOINT ["node", "dist/index.js"]
