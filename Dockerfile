# Multi-stage Docker build for cloud clipboard application
# Stage 1: Build dependencies and shared package
FROM node:18-alpine AS deps
WORKDIR /app

# Install system dependencies for native modules
RUN apk add --no-cache libc6-compat python3 make g++

# Copy package files for dependency installation
COPY package.json bun.lockb ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install bun for faster builds
RUN npm install -g bun

# Install dependencies
RUN bun install --frozen-lockfile

# Stage 2: Build shared package
FROM node:18-alpine AS shared-builder
WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy shared source
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY shared ./shared
COPY package.json bun.lockb ./

# Build shared package
RUN bun run shared:build

# Stage 3: Build server
FROM node:18-alpine AS server-builder
WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy dependencies and built shared package
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY --from=shared-builder /app/shared/dist ./shared/dist
COPY --from=shared-builder /app/shared/package.json ./shared/package.json

# Copy server source
COPY server ./server
COPY package.json bun.lockb ./

# Build server
RUN bun run server:build

# Stage 4: Build client
FROM node:18-alpine AS client-builder
WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy dependencies and built shared package
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY --from=shared-builder /app/shared/dist ./shared/dist
COPY --from=shared-builder /app/shared/package.json ./shared/package.json

# Copy client source
COPY client ./client
COPY package.json bun.lockb ./

# Build client with production environment
ENV NODE_ENV=production
ENV VITE_SERVER_URL=http://localhost:3001
RUN bun run client:build

# Stage 5: Production runtime
FROM node:18-alpine AS runtime

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S cloudclipboard -u 1001

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Install bun runtime
RUN npm install -g bun

# Copy production files
COPY --from=server-builder --chown=cloudclipboard:nodejs /app/server/dist ./server/dist
COPY --from=client-builder --chown=cloudclipboard:nodejs /app/client/dist ./client/dist
COPY --from=shared-builder --chown=cloudclipboard:nodejs /app/shared/dist ./shared/dist

# Copy package files for runtime dependencies
COPY --from=server-builder --chown=cloudclipboard:nodejs /app/server/package.json ./server/
COPY --from=shared-builder --chown=cloudclipboard:nodejs /app/shared/package.json ./shared/
COPY --chown=cloudclipboard:nodejs package.json ./

# Install only production dependencies
ENV NODE_ENV=production
COPY --from=deps --chown=cloudclipboard:nodejs /app/node_modules ./node_modules

# Create uploads directory with proper permissions
RUN mkdir -p /app/uploads && chown -R cloudclipboard:nodejs /app/uploads

# Switch to non-root user
USER cloudclipboard

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun --version > /dev/null || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["bun", "run", "server/dist/index.js"]