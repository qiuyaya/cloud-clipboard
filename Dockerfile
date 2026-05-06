# Stage 1: 构建前端
FROM oven/bun AS frontend-builder

WORKDIR /app

# 复制依赖文件
COPY ./ ./

# 安装依赖
RUN bun install --frozen-lockfile

# 构建参数
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

# 构建前端
ENV NODE_ENV=production
RUN bun run build

# Stage 2: 构建 Rust 后端
FROM rust:1.93-alpine AS rust-builder

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

# 先编译依赖（利用 Docker 层缓存）
COPY server-rust/Cargo.toml server-rust/Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/deps/cloud_clipboard*

# 复制实际源码并编译
COPY server-rust/src ./src
RUN cargo build --release

# Stage 3: 极简运行时
FROM alpine:3.22.0 AS runtime

# 安装运行时依赖
RUN apk add --no-cache ca-certificates libstdc++ curl

WORKDIR /app

# 复制 Rust 编译产物
COPY --from=rust-builder /app/target/release/cloud-clipboard-server /app/cloud-clipboard-server

# 复制前端静态文件
COPY --from=frontend-builder /app/client/dist /app/public

# 创建 uploads 和 data 目录并设置权限
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /app/uploads /app/data && chown -R appuser:appgroup /app/uploads /app/data

EXPOSE 3001

ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads
ENV STATIC_DIR=/app/public

# 以非 root 用户运行
USER appuser

CMD ["/app/cloud-clipboard-server"]
