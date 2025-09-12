# 使用官方轻量级Bun Alpine镜像
FROM oven/bun:1-alpine

# 安装运行时和构建时依赖，然后立即清理
RUN apk add --no-cache curl python3 make g++ && \
    rm -rf /var/cache/apk/* /tmp/*

# 创建非特权用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cloudclipboard -u 1001

WORKDIR /app

# 复制依赖文件以利用缓存
COPY package.json bun.lock ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json  
COPY client/package.json ./client/package.json

# 安装所有依赖
RUN bun install --frozen-lockfile

# 复制源码和必要脚本
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts/generate-icons.js ./scripts/generate-icons.js

# 构建所有组件并清理
ENV NODE_ENV=production
RUN bun run shared:build && \
    bun run icons:generate && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client && \
    rm -rf shared/src server/src client/src scripts && \
    rm -rf node_modules && \
    bun install --production --frozen-lockfile && \
    rm -rf ~/.bun/install/cache /tmp/* && \
    apk del python3 make g++

# 创建上传目录并设置权限
RUN mkdir -p uploads && \
    chown -R cloudclipboard:nodejs /app

# 切换到非特权用户
USER cloudclipboard

# 暴露端口
EXPOSE 3001

# 环境变量
ENV NODE_ENV=production \
    PORT=3001 \
    UPLOAD_DIR=/app/uploads

# 精简健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# 启动应用
CMD ["bun", "run", "server/dist/index.js"]