# 使用轻量级Bun Alpine镜像 
FROM oven/bun:1-alpine

# 安装必要依赖
RUN apk add --no-cache curl python3 make g++

# 创建非特权用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cloudclipboard -u 1001

WORKDIR /app

# 复制项目文件
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# 安装依赖
RUN bun install

# 复制源码
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts

# 构建项目
ENV NODE_ENV=production
RUN bun run shared:build && \
    bun run icons:generate && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client

# 清理构建依赖，保留运行时需要的文件
RUN rm -rf shared/src client/src server/src scripts && \
    rm -rf node_modules && \
    bun install --production && \
    apk del python3 make g++ && \
    rm -rf /var/cache/apk/*

# 创建上传目录
RUN mkdir -p uploads && \
    chown -R cloudclipboard:nodejs /app

USER cloudclipboard

EXPOSE 3001

ENV NODE_ENV=production \
    PORT=3001 \
    UPLOAD_DIR=/app/uploads

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

CMD ["bun", "run", "server/dist/index.js"]