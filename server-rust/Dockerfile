# 仅用于编译 Rust 后端的 Dockerfile
FROM rust:1.93-alpine AS builder

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

# 复制源码
COPY Cargo.toml Cargo.lock* ./
COPY src ./src

# 编译
RUN cargo build --release

# 输出阶段 - 仅包含编译产物
FROM scratch AS export
COPY --from=builder /app/target/release/cloud-clipboard-server /
