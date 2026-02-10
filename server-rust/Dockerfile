# Cloud Clipboard Rust 后端 - 包含前端静态文件
FROM rust:1.93-alpine AS builder

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

# 复制源码
COPY Cargo.toml Cargo.lock* ./
COPY src ./src

# 编译
RUN cargo build --release

# 输出阶段 - 包含运行时和前端静态文件
FROM alpine:3.22.0 AS runtime

# 安装运行时依赖
RUN apk add --no-cache ca-certificates libstdc++ curl

WORKDIR /app

# 复制编译产物
COPY --from=builder /app/target/release/cloud-clipboard-server /app/cloud-clipboard-server

# 复制前端静态文件（从构建上下文）
COPY public /app/public

# 确保上传目录存在
RUN mkdir -p /app/uploads && chmod 755 /app/uploads

EXPOSE 3001

# 运行
CMD ["/app/cloud-clipboard-server"]
