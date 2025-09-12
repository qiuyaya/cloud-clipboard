# Stage 1: 构建阶段
FROM oven/bun AS builder

WORKDIR /app

# 复制依赖文件到正确的位置（遵循monorepo结构）
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# 安装所有依赖（包括devDependencies用于构建）
RUN bun install

# 复制源代码
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts

# 按正确顺序构建：shared -> icons -> client -> server
ENV NODE_ENV=production
RUN bun run shared:build && \
    bun run icons:generate && \
    bun run client:build && \
    bun run server:build && \
    bun run copy-client

# 清理devDependencies，只保留生产依赖
RUN rm -rf node_modules && \
    bun install --production

# Stage 2: 极简运行时
FROM oven/bun:alpine AS runtime

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

CMD ["bun", "run", "server/dist/index.js"]