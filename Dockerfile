# Stage 1: 构建阶段
FROM node:18-alpine AS builder

# 安装构建依赖
RUN apk add --no-cache python3 make g++ curl

WORKDIR /app

# 安装bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# 复制依赖文件
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源代码
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts

# 构建
ENV NODE_ENV=production
RUN bun run shared:build && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client

# 清理dev依赖
RUN bun install --production --frozen-lockfile

# Stage 2: 极简运行时
FROM alpine:3.19 AS runtime

# 安装运行时必需品（仅curl用于健康检查）
RUN apk add --no-cache curl

# 安装bun运行时（无需Node.js）
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# 创建用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cloudclipboard -u 1001

WORKDIR /app

# 复制构建产物和生产依赖
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/dist ./server/dist
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/public ./server/public
COPY --from=builder --chown=cloudclipboard:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=cloudclipboard:nodejs /app/node_modules ./node_modules

# 创建必要目录
RUN mkdir -p /app/uploads && \
    chown -R cloudclipboard:nodejs /app/uploads

USER cloudclipboard

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

# 简化的健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "run", "server/dist/index.js"]