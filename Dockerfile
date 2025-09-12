# 基础镜像
FROM oven/bun:1-alpine

# 安装运行时依赖
RUN apk add --no-cache curl

# 工作目录
WORKDIR /app

# 复制所有文件
COPY . .

# 安装依赖并构建
RUN bun install && \
    bun run shared:build && \
    bun run icons:generate && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client

# 创建上传目录
RUN mkdir -p uploads

# 暴露端口
EXPOSE 3001

# 环境变量
ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# 启动应用
CMD ["bun", "run", "server/dist/index.js"]