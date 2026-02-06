# Stage 1: 构建阶段
FROM oven/bun AS builder

WORKDIR /app

# 复制依赖文件
COPY ./ ./

# 安装依赖
RUN bun install --frozen-lockfile

# 构建参数
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

# 构建
ENV NODE_ENV=production
RUN bun run build

# Stage 2: 极简运行时
FROM oven/bun:alpine AS runtime

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/public ./server/public

# 复制依赖（包含所有工作区依赖）
COPY --from=builder /app/node_modules ./node_modules

# 创建 uploads 目录并设置权限
RUN mkdir -p /app/uploads && chown -R bun:bun /app/uploads

# 安装 gosu 用于切换用户
RUN apk add --no-cache gosu

# 创建启动脚本
COPY <<EOF /app/entrypoint.sh
#!/bin/sh
# 修复 volume 挂载后的权限
chown -R bun:bun /app/uploads
# 切换到 bun 用户运行应用
exec gosu bun bun server/dist/index.js
EOF
RUN chmod +x /app/entrypoint.sh

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

CMD ["/app/entrypoint.sh"]