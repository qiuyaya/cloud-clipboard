# 使用官方的轻量级Alpine Linux Bun镜像
FROM oven/bun:1-alpine AS builder

# 安装构建时依赖（仅Python和Make，减少体积）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 先复制package.json和锁文件以利用Docker缓存
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# 安装所有依赖（包括devDependencies用于构建）
RUN bun install --frozen-lockfile

# 复制源代码
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts

# 构建所有包（包括图标生成）
ENV NODE_ENV=production
RUN bun run shared:build && \
    bun run icons:generate && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client

# 重新安装仅生产依赖
RUN rm -rf node_modules && \
    bun install --production --frozen-lockfile

# Stage 2: 极简运行时镜像
FROM oven/bun:1-alpine AS runtime

# 仅安装健康检查必需的curl
RUN apk add --no-cache curl && \
    rm -rf /var/cache/apk/*

# 创建非root用户以提高安全性
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cloudclipboard -u 1001

WORKDIR /app

# 复制构建产物（仅复制必需文件）
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/dist ./
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/public ./public
COPY --from=builder --chown=cloudclipboard:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=cloudclipboard:nodejs /app/shared/dist ./node_modules/shared/dist
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/package.json ./package.json

# 创建上传目录
RUN mkdir -p uploads && \
    chown cloudclipboard:nodejs uploads

USER cloudclipboard

EXPOSE 3001

ENV NODE_ENV=production \
    PORT=3001 \
    UPLOAD_DIR=/app/uploads

# 优化的健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# 直接运行入口文件，减少一层调用
CMD ["bun", "run", "index.js"]