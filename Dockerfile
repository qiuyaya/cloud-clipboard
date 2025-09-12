# Stage 1: 构建阶段
FROM oven/bun AS builder

WORKDIR /app

# 复制依赖文件
COPY ./ ./

# 安装依赖
RUN bun install --frozen-lockfile

# 构建
ENV NODE_ENV=production
RUN bun run build

# 清理dev依赖
RUN rm -rf node_modules
RUN bun install --production --frozen-lockfile

# Stage 2: 极简运行时
FROM oven/bun:alpine AS runtime

# 创建用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S cloudclipboard -u 1001

WORKDIR /app

# 复制构建产物和生产依赖
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/dist ./server/dist
COPY --from=builder --chown=cloudclipboard:nodejs /app/server/public ./server/public
COPY --from=builder --chown=cloudclipboard:nodejs /app/node_modules ./node_modules

# 创建必要目录
RUN mkdir -p /app/uploads && \
    chown -R cloudclipboard:nodejs /app/uploads

USER cloudclipboard

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

CMD ["bun", "run", "server/dist/index.js"]