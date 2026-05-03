# 删除 Node.js 后端，Rust 后端提升为唯一后端

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 `server/` 目录（Node.js 后端），将 `server-rust/` 提升为项目唯一后端，更新所有构建、部署、CI/CD 和文档引用。

**Architecture:** 项目从双后端架构迁移为 Rust-only 后端。`server-rust/` 目录保持不动（不重命名），避免破坏 Cargo 工作区。所有原先指向 `server/` 的脚本、CI、Docker、文档全部改为指向 Rust 后端。开发流程从 `bun run server:dev` 改为 Docker-based Rust 编译。

**Tech Stack:** Rust 1.93 + Axum 0.8 + SocketiOxide 0.15, Bun (前端构建), Docker (Rust 编译)

---

## 文件变更总览

| 操作 | 文件                                           |
| ---- | ---------------------------------------------- |
| 删除 | `server/` 整个目录                             |
| 修改 | `package.json` (根)                            |
| 修改 | `Dockerfile`                                   |
| 修改 | `docker-compose.yml`                           |
| 修改 | `docker-compose.nginx.yml`                     |
| 修改 | `.github/workflows/ci.yml`                     |
| 修改 | `.github/workflows/test.yml`                   |
| 修改 | `.github/workflows/release.yml`                |
| 修改 | `scripts/release.js`                           |
| 修改 | `scripts/version-sync.js`                      |
| 修改 | `.env.example`                                 |
| 修改 | `.env.production`                              |
| 修改 | `README.md`                                    |
| 修改 | `CLAUDE.md`                                    |
| 修改 | `.husky/pre-push`                              |
| 修改 | `eslint.config.js` (清理 server/ 相关 ignores) |

---

### Task 1: 更新根 package.json — 移除 server 脚本和 workspace

**Files:**

- Modify: `package.json:1-85`

- [ ] **Step 1: 移除 workspace 中的 server 条目，更新脚本**

将 `package.json` 中的以下内容：

```json
"scripts": {
    "dev": "concurrently \"bun run server:dev\" \"bun run client:dev\"",
    "build": "bun run icons:generate && bun run client:build && bun run build:production",
    "build:production": "bun run server:build && bun run copy-client",
    "copy-client": "rm -rf server/public && cp -r client/dist server/public",
    "icons:generate": "node scripts/generate-icons.js",
    "start": "bun run server:start",
    "server:dev": "cd server && bun run dev",
    "server:build": "cd server && bun run build",
    "server:start": "cd server && NODE_ENV=production bun run start",
    "client:dev": "cd client && bun run dev",
    "client:build": "cd client && bun run build",
```

替换为：

```json
"scripts": {
    "dev": "bun run client:dev",
    "build": "bun run icons:generate && bun run client:build",
    "copy-client": "rm -rf server-rust/public && cp -r client/dist server-rust/public",
    "icons:generate": "node scripts/generate-icons.js",
    "client:dev": "cd client && bun run dev",
    "client:build": "cd client && bun run build",
```

将测试相关脚本：

```json
"test": "bun run shared:test && bun run server:test && bun run client:test",
"test:watch": "concurrently \"bun run shared:test:watch\" \"bun run server:test:watch\" \"bun run client:test:watch\"",
"test:integration": "bun run server:test:integration",
```

替换为：

```json
"test": "bun run shared:test && bun run client:test",
"test:watch": "concurrently \"bun run shared:test:watch\" \"bun run client:test:watch\"",
```

删除以下脚本行：

```json
"server:test": "cd server && bun run test",
"server:test:watch": "cd server && bun run test:watch",
"server:test:integration": "cd server && bun run test:integration",
```

将 type-check 脚本：

```json
"type-check": "cd shared && tsc --noEmit --skipLibCheck --skipDefaultLibCheck && cd ../server && tsc --noEmit --skipLibCheck --skipDefaultLibCheck",
"server:type-check": "cd server && tsc --noEmit",
```

替换为：

```json
"type-check": "cd shared && tsc --noEmit --skipLibCheck --skipDefaultLibCheck",
```

删除 `server:type-check` 行。

将 workspaces：

```json
"workspaces": [
    "server",
    "client",
    "shared"
],
```

替换为：

```json
"workspaces": [
    "client",
    "shared"
],
```

删除以下不再需要的脚本：

- `"build:production"`
- `"start"`
- `"test:integration"`
- `"test:e2e"`（保留如果 client 有 e2e 测试）

保留 `validate` 和 `validate:quick` 等脚本（它们基于 test/type-check/lint，已更新的脚本会自动生效）。

- [ ] **Step 2: 验证 package.json 格式正确**

Run: `cd /home/cc/workspace/cloud-clipboard && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: 重新安装依赖确保 workspace 更新**

Run: `cd /home/cc/workspace/cloud-clipboard && bun install`
Expected: 安装成功，不再包含 server workspace

- [ ] **Step 4: 提交**

```bash
git add package.json bun.lock
git commit -m "chore: remove Node.js server from workspace and scripts"
```

---

### Task 2: 更新 Dockerfile — 改为构建 Rust 后端

**Files:**

- Modify: `Dockerfile:1-44`

- [ ] **Step 1: 重写 Dockerfile**

将整个 `Dockerfile` 替换为：

```dockerfile
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

# 复制 Rust 源码
COPY server-rust/Cargo.toml server-rust/Cargo.lock* ./
COPY server-rust/src ./src

# 编译
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

# 创建 uploads 目录并设置权限
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /app/uploads && chown -R appuser:appgroup /app/uploads

EXPOSE 3001

ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads
ENV STATIC_DIR=/app/public

# 以非 root 用户运行
USER appuser

CMD ["/app/cloud-clipboard-server"]
```

- [ ] **Step 2: 验证 Dockerfile 语法**

Run: `docker build --check -f /home/cc/workspace/cloud-clipboard/Dockerfile /home/cc/workspace/cloud-clipboard 2>&1 || echo "docker build --check not supported, skipping syntax check"`

- [ ] **Step 3: 提交**

```bash
git add Dockerfile
git commit -m "chore: rewrite Dockerfile to build Rust backend with frontend"
```

---

### Task 3: 更新 docker-compose 文件

**Files:**

- Modify: `docker-compose.yml:1-28`
- Modify: `docker-compose.nginx.yml:1-96`

- [ ] **Step 1: 更新 docker-compose.yml**

将 `docker-compose.yml` 替换为：

```yaml
services:
  # Main application service - unified deployment
  cloud-clipboard:
    build: .
    container_name: cloud-clipboard-app
    restart: unless-stopped
    ports:
      - "6030:6030"
    environment:
      - TZ=Asia/Shanghai
      - PORT=6030
      - UPLOAD_DIR=/app/uploads
      - STATIC_DIR=/app/public
      - MAX_FILE_SIZE=104857600 # 100MB in bytes
      - ROOM_CLEANUP_INTERVAL_SECONDS=3600 # 1 hour in seconds
      - FILE_RETENTION_HOURS=12
      - RATE_LIMIT_WINDOW=60 # 1 minute in seconds
      - RATE_LIMIT_MAX_REQUESTS=100
      - ALLOW_HTTP=true # Allow HTTP connections for development
    volumes:
      - uploads:/app/uploads
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=100M,noexec,nosuid,nodev

volumes:
  uploads:
```

- [ ] **Step 2: 更新 docker-compose.nginx.yml**

将 `docker-compose.nginx.yml` 中的 `cloud-clipboard` 服务部分替换（保留 nginx 和 watchtower 不变）：

services 中的 cloud-clipboard 部分改为：

```yaml
cloud-clipboard:
  image: ghcr.io/qiuyaya/cloud-clipboard:latest
  container_name: cloud-clipboard-app
  restart: unless-stopped
  ports:
    - "3001:3001"
  environment:
    - PORT=3001
    - UPLOAD_DIR=/app/uploads
    - STATIC_DIR=/app/public
    - MAX_FILE_SIZE=104857600 # 100MB in bytes
    - ROOM_CLEANUP_INTERVAL_SECONDS=3600 # 1 hour in seconds
    - FILE_RETENTION_HOURS=12
    - RATE_LIMIT_WINDOW=60 # 1 minute in seconds
    - RATE_LIMIT_MAX_REQUESTS=100
  volumes:
    - uploads:/app/uploads
    - ./logs:/app/logs
  networks:
    - cloud-clipboard-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
  security_opt:
    - no-new-privileges:true
  read_only: true
  tmpfs:
    - /tmp:size=100M,noexec,nosuid,nodev
```

注意：

- 移除 `version: "3.8"`（已过时）
- 移除 `NODE_ENV`（Rust 不需要）
- healthcheck 改为 `curl`（alpine 镜像已包含）
- 移除 `user: "1001:1001"`（Dockerfile 中已设置非 root 用户）

- [ ] **Step 3: 提交**

```bash
git add docker-compose.yml docker-compose.nginx.yml
git commit -m "chore: update docker-compose files for Rust backend"
```

---

### Task 4: 更新 CI workflow (ci.yml)

**Files:**

- Modify: `.github/workflows/ci.yml:1-250`

- [ ] **Step 1: 重写 ci.yml**

主要变更：

1. `test-web` job 中的 `bun run build` 改为只构建前端 `bun run build`（已更新后的脚本）
2. 移除 `version-check` job 中对 `server` 的检查
3. 其余保持不变（test-rust 已存在）

将 `version-check` job 中的 PACKAGES 数组：

```bash
PACKAGES=("client" "server" "shared")
```

替换为：

```bash
PACKAGES=("client" "shared")
```

在 `test-web` job 中，`bun run build` 已经会使用更新后的脚本（只构建前端），无需额外修改。

在 `build-status` 的 needs 中保持不变：`[lint-and-check, test-web, test-rust, security-audit, version-check]`。

- [ ] **Step 2: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: remove Node.js server references from CI workflow"
```

---

### Task 5: 更新 test workflow (test.yml)

**Files:**

- Modify: `.github/workflows/test.yml:1-295`

- [ ] **Step 1: 更新 unit-tests job**

将 unit-tests job 中的步骤：

```yaml
- name: Run shared tests
  run: bun run shared:test

- name: Run server tests
  run: bun run server:test

- name: Run client tests
  run: bun run client:test
```

替换为：

```yaml
- name: Run shared tests
  run: bun run shared:test

- name: Run client tests
  run: bun run client:test
```

- [ ] **Step 2: 移除 integration-tests job 或改为 Rust 集成测试**

将 `integration-tests` job 整体替换为：

```yaml
integration-tests:
  name: Rust Integration Tests
  runs-on: ubuntu-latest

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Create cargo cache directories
      run: mkdir -p ~/.cargo/registry ~/.cargo/git

    - name: Cache Rust dependencies
      uses: actions/cache@v4
      with:
        path: |
          ~/.cargo/registry
          ~/.cargo/git
        key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
        restore-keys: |
          ${{ runner.os }}-cargo-

    - name: Run Rust integration tests
      run: |
        cd server-rust
        docker run --rm \
          -v $(pwd):/app \
          -v ~/.cargo/registry:/root/.cargo/registry \
          -v ~/.cargo/git:/root/.cargo/git \
          -w /app rust:1.93-alpine sh -c "
          apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static > /dev/null 2>&1 &&
          cargo test --all-features --no-fail-fast
        "
```

- [ ] **Step 3: 更新 build-test job**

将 build-test job 中的检查步骤：

```yaml
- name: Check build artifacts
  run: |
    ls -la server/dist/
    ls -la client/dist/
```

替换为：

```yaml
- name: Check build artifacts
  run: |
    ls -la client/dist/
```

- [ ] **Step 4: 更新 performance-test job**

将 performance-test job 中启动和停止服务器的步骤替换为 Docker-based Rust 后端测试：

```yaml
- name: Build and start Rust server for performance test
  run: |
    cd server-rust
    docker build -t cloud-clipboard-perf .
    # Copy client dist to server-rust/public for the test
    cp -r ../client/dist ./public 2>/dev/null || true
    docker run -d --name perf-test -p 3001:3001 cloud-clipboard-perf
    sleep 5

- name: Run basic performance tests
  run: |
    # Test server health endpoint
    curl -f http://localhost:3001/api/health

    # Test server response time
    time curl -f http://localhost:3001/api/health

- name: Stop server
  run: docker rm -f perf-test || true
```

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/test.yml
git commit -m "ci: update test workflow for Rust-only backend"
```

---

### Task 6: 更新 release workflow (release.yml)

**Files:**

- Modify: `.github/workflows/release.yml:1-322`

- [ ] **Step 1: 移除 Node.js Docker build job，Rust 成为主镜像**

删除整个 `build-docker` job（lines 15-100）。

将 `build-docker-rust` job 重命名为 `build-docker`，并修改镜像名：

- `ghcr.io/${{ github.repository }}-rust` → `ghcr.io/${{ github.repository }}`

具体修改 `build-docker-rust` job 中的 meta 步骤：

```yaml
- name: Extract metadata for Docker (root path)
  id: meta_rust
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}
```

和：

```yaml
- name: Extract metadata for Docker (clipboard subpath)
  id: meta_rust_clipboard
  uses: docker/metadata-action@v5
  with:
    images: ghcr.io/${{ github.repository }}
```

同时将构建步骤中的 context 和 file 更新为使用根 Dockerfile（新的多阶段构建）：

```yaml
- name: Build and push Docker image (root path)
  uses: docker/build-push-action@v4
  with:
    context: .
    file: ./Dockerfile
    push: true
    platforms: linux/amd64
    tags: ${{ steps.meta_rust.outputs.tags }}
    labels: ${{ steps.meta_rust.outputs.labels }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

clipboard subpath 版本类似，添加 `build-args: VITE_BASE_PATH=/clipboard/`。

由于新的 Dockerfile 已包含前端构建，可以移除 job 中的 Bun setup 和 `bun install` 步骤（前端构建已在 Docker 内完成）。

- [ ] **Step 2: 更新 release notes**

将 release notes 中的双镜像描述改为单镜像：

```bash
cat > release_notes.md << EOF
## Cloud Clipboard ${{ steps.get_version.outputs.version }}

### What's New
${COMMITS}

### Docker Images

- **Docker (根路径/root path)**: \`docker pull ghcr.io/${{ github.repository }}:${{ steps.get_version.outputs.version_number }}\`
- **Docker (子路径/subpath /clipboard/)**: \`docker pull ghcr.io/${{ github.repository }}:${{ steps.get_version.outputs.version_number }}-clipboard\`

### Quick Start

\`\`\`bash
docker run -p 3001:3001 -v ./uploads:/app/uploads ghcr.io/${{ github.repository }}:${{ steps.get_version.outputs.version_number }}
\`\`\`

Visit: http://localhost:3001

---

**Full Changelog**: https://github.com/${{ github.repository }}/compare/${PREVIOUS_TAG}...${{ steps.get_version.outputs.version }}
EOF
```

- [ ] **Step 3: 更新 create-release needs**

```yaml
create-release:
  name: Create Release
  needs: [build-docker]
  if: always() && needs.build-docker.result == 'success'
```

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/release.yml
git commit -m "ci: simplify release to single Rust-based Docker image"
```

---

### Task 7: 更新发布和版本管理脚本

**Files:**

- Modify: `scripts/release.js:17-22`
- Modify: `scripts/version-sync.js:16-21`

- [ ] **Step 1: 更新 release.js 中的 PACKAGES 数组**

将：

```javascript
const PACKAGES = [
  { name: "root", path: WORKSPACE_ROOT },
  { name: "client", path: path.join(WORKSPACE_ROOT, "client") },
  { name: "server", path: path.join(WORKSPACE_ROOT, "server") },
  { name: "shared", path: path.join(WORKSPACE_ROOT, "shared") },
];
```

替换为：

```javascript
const PACKAGES = [
  { name: "root", path: WORKSPACE_ROOT },
  { name: "client", path: path.join(WORKSPACE_ROOT, "client") },
  { name: "shared", path: path.join(WORKSPACE_ROOT, "shared") },
];
```

- [ ] **Step 2: 对 version-sync.js 做同样的修改**

将：

```javascript
const PACKAGES = [
  { name: "root", path: WORKSPACE_ROOT },
  { name: "client", path: path.join(WORKSPACE_ROOT, "client") },
  { name: "server", path: path.join(WORKSPACE_ROOT, "server") },
  { name: "shared", path: path.join(WORKSPACE_ROOT, "shared") },
];
```

替换为：

```javascript
const PACKAGES = [
  { name: "root", path: WORKSPACE_ROOT },
  { name: "client", path: path.join(WORKSPACE_ROOT, "client") },
  { name: "shared", path: path.join(WORKSPACE_ROOT, "shared") },
];
```

- [ ] **Step 3: 提交**

```bash
git add scripts/release.js scripts/version-sync.js
git commit -m "chore: remove server package from release and version scripts"
```

---

### Task 8: 更新环境变量文件

**Files:**

- Modify: `.env.example`
- Modify: `.env.production`

- [ ] **Step 1: 更新 .env.example**

替换为：

```env
PORT=3001

# Client configuration
CLIENT_URL=http://localhost:3000,http://localhost:3002
VITE_SERVER_URL=http://localhost:3001

# File upload configuration
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600

# Static files directory
STATIC_DIR=./public

# Room and file management
ROOM_CLEANUP_INTERVAL_SECONDS=3600
FILE_RETENTION_HOURS=12

# Rate limiting
RATE_LIMIT_WINDOW=60
RATE_LIMIT_MAX_REQUESTS=100

# Security settings
ALLOW_HTTP=true

# Sub-path deployment (optional)
# BASE_PATH=/clipboard

# Public URL for share links (optional)
# PUBLIC_URL=https://clipboard.example.com

# Logging (Rust tracing)
RUST_LOG=cloud_clipboard_server=info,tower_http=info
```

- [ ] **Step 2: 更新 .env.production**

替换为：

```env
PORT=3001

# Client configuration
CLIENT_URL=https://your-domain.com
VITE_SERVER_URL=https://your-domain.com

# File upload configuration
UPLOAD_DIR=/app/uploads
MAX_FILE_SIZE=104857600

# Static files directory
STATIC_DIR=/app/public

# Room and file management
ROOM_CLEANUP_INTERVAL_SECONDS=3600
FILE_RETENTION_HOURS=12

# Rate limiting
RATE_LIMIT_WINDOW=60
RATE_LIMIT_MAX_REQUESTS=100

# Security settings
ALLOW_HTTP=false

# Public URL for share links
# PUBLIC_URL=https://clipboard.example.com

# Logging
RUST_LOG=cloud_clipboard_server=info,tower_http=info
```

- [ ] **Step 3: 提交**

```bash
git add .env.example .env.production
git commit -m "chore: update env files for Rust backend"
```

---

### Task 9: 更新 pre-push hook

**Files:**

- Modify: `.husky/pre-push`

- [ ] **Step 1: 移除 build 检查（Rust 需要 Docker 编译，不适合在 hook 中执行）**

将 `.husky/pre-push` 替换为：

```bash
#!/usr/bin/env sh
. "$(dirname "$0")/_/h"

# 运行快速校验流程（前端 lint、类型检查、格式检查）
echo "Running quick validation before push..."
bun run validate:quick

echo "All checks passed! Ready to push."
```

注意：移除 `bun run validate`（包含 test，可能太慢）和 `bun run build`（Node.js build 已不存在，Rust build 需 Docker），改为 `validate:quick`。

- [ ] **Step 2: 提交**

```bash
git add .husky/pre-push
git commit -m "chore: simplify pre-push hook for Rust backend"
```

---

### Task 10: 清理 eslint 配置中的 server 引用

**Files:**

- Modify: `eslint.config.js`

- [ ] **Step 1: 移除 server/ 相关的 ignore 条目**

在 `eslint.config.js` 的 ignores 数组中，移除：

```javascript
"server/dist/**",
"server/uploads/**",
"server/public/**",
```

这三行在 `server/` 删除后已无意义。`server-rust/**` 的 ignore 保留。

- [ ] **Step 2: 提交**

```bash
git add eslint.config.js
git commit -m "chore: remove server/ ignores from eslint config"
```

---

### Task 11: 删除 server/ 目录

**Files:**

- Delete: `server/` (整个目录)

- [ ] **Step 1: 删除 server 目录**

Run: `rm -rf /home/cc/workspace/cloud-clipboard/server`

- [ ] **Step 2: 验证删除成功**

Run: `ls /home/cc/workspace/cloud-clipboard/server 2>&1`
Expected: `ls: cannot access '/home/cc/workspace/cloud-clipboard/server': No such file or directory`

- [ ] **Step 3: 验证 bun install 仍然正常**

Run: `cd /home/cc/workspace/cloud-clipboard && bun install`
Expected: 成功安装，无报错

- [ ] **Step 4: 验证前端构建仍然正常**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run build`
Expected: 前端构建成功

- [ ] **Step 5: 验证 validate:quick 通过**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run validate:quick`
Expected: 格式检查、lint、类型检查全部通过

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore: remove Node.js server - Rust backend is now the sole backend"
```

---

### Task 12: 更新 README.md

**Files:**

- Modify: `README.md`

- [ ] **Step 1: 更新架构说明（中文部分）**

将 lines 39-46（架构部分）：

```markdown
## 🏗️ 架构

这个项目采用monorepo架构，包含四个主要包：

- **`shared/`** - 公共类型、模式和工具（TypeScript + Zod）
- **`server/`** - 后端API和WebSocket服务器（Node.js + Express + Socket.IO）
- **`server-rust/`** - Rust 后端实现（Rust + Axum + SocketiOxide）⭐ 新增
- **`client/`** - 前端React应用程序（React + Vite + Tailwind CSS）
```

替换为：

```markdown
## 🏗️ 架构

这个项目采用monorepo架构，包含三个主要包：

- **`shared/`** - 公共类型、模式和工具（TypeScript + Zod）
- **`server-rust/`** - 后端 API 和 WebSocket 服务器（Rust + Axum + SocketiOxide）
- **`client/`** - 前端 React 应用程序（React + Vite + Tailwind CSS）
```

- [ ] **Step 2: 更新技术栈（中文部分）**

删除 "后端 (Node.js)" 部分（lines 50-58），将 "后端 (Rust) ⭐ 新增" 改为 "后端"：

```markdown
## 🛠️ 技术栈

### 后端

- **语言**: Rust 1.93+
- **框架**: Axum 0.8
- **WebSocket**: SocketiOxide 0.15
- **异步运行时**: Tokio
- **序列化**: Serde + serde_json
- **安全**: bcrypt 加密、SHA-256 哈希、secure random
- **中间件**: Tower + tower-http（CORS、压缩、限流）
- **测试**: 15 个测试模块，完善的单元测试和集成测试覆盖
- **性能**: 高性能和内存安全
```

- [ ] **Step 3: 更新开发命令（中文部分）**

将开发部分（lines 105-141）中的服务器启动命令更新：

````markdown
### 开发

启动客户端开发模式：

```bash
bun run dev
```
````

客户端运行在 http://localhost:3000，开发时通过 Vite 代理连接到后端。

Rust 后端需要单独通过 Docker 启动：

```bash
cd server-rust && docker build -t cloud-clipboard-rust . && docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard-rust
```

### 生产环境

使用 Docker 构建完整应用（前端 + 后端）：

```bash
docker build -t cloud-clipboard .
docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard
```

> **注意**: 生产环境下，前端和后端会运行在同一个端口（默认3001），无需分别部署。

````

- [ ] **Step 4: 更新环境变量说明（中文部分）**

将环境变量部分（lines 229-253）更新为 Rust 后端的变量：

```markdown
## 🌍 环境变量

### 服务器

- `PORT` - 服务器端口（默认：3001）
- `CLIENT_URL` - 前端URL用于CORS（默认：*）
- `ALLOW_HTTP` - 允许HTTP连接（默认：false）
- `UPLOAD_DIR` - 文件上传目录（默认：./uploads）
- `STATIC_DIR` - 静态文件目录（默认：./public）
- `MAX_FILE_SIZE` - 最大文件大小（默认：104857600 = 100MB）
- `ROOM_CLEANUP_INTERVAL_SECONDS` - 房间清理间隔秒数（默认：60）
- `FILE_RETENTION_HOURS` - 文件保留时间（默认：12小时）
- `FILE_CLEANUP_INTERVAL_SECONDS` - 文件清理间隔秒数（默认：600）
- `RATE_LIMIT_WINDOW` - 速率限制窗口秒数（默认：60）
- `RATE_LIMIT_MAX_REQUESTS` - 每窗口最大请求数（默认：500）
- `PUBLIC_DOWNLOAD_RATE_LIMIT` - 公开下载每分钟最大请求数（默认：20）
- `MAX_PINNED_ROOMS` - 最大固定房间数（默认：50）
- `BASE_PATH` - 子路径部署（可选，例如：/clipboard）
- `PUBLIC_URL` - 公网访问地址，用于生成分享链接（例如：https://clipboard.example.com）
- `RUST_LOG` - 日志级别（默认：cloud_clipboard_server=info,tower_http=info）
````

- [ ] **Step 5: 更新开发命令列表（中文部分）**

将 lines 259-306 中的命令列表更新，移除 `server:build`、`server:dev`、`start` 等：

````markdown
## 📋 开发命令

```bash
# 安装依赖
bun install

# 启动前端开发服务器
bun run dev

# 构建前端
bun run build

# 运行类型检查
bun run type-check

# 运行代码检查
bun run lint
bun run lint:fix               # 自动修复ESLint错误

# 代码格式化
bun run format                 # 使用Prettier格式化代码
bun run format:check           # 检查代码格式

# Rust 后端（需要 Docker）
cd server-rust && docker build -t cloud-clipboard-rust .                    # 构建
cd server-rust && docker run --rm -v $(pwd):/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"  # 测试

# 图标管理
bun run icons:generate         # 生成Web图标

# 版本管理
bun run version:check          # 检查版本一致性
bun run version:report         # 生成版本报告

# 发布管理
bun run release:patch          # 发布补丁版本
bun run release:minor          # 发布次要版本
bun run release:major          # 发布主要版本
bun run release:dry-run        # 预览发布更改
```
````

````

- [ ] **Step 6: 对英文部分做同样的更新**

英文部分（lines 322 以后）做对应的修改：架构、技术栈、开发命令、环境变量。内容与中文部分对应。

- [ ] **Step 7: 更新后端日志配置说明**

将中文部分的后端日志配置（lines 184-193）替换为：

```markdown
### 后端日志配置

通过环境变量配置 Rust 后端日志：

```bash
export RUST_LOG=cloud_clipboard_server=debug,tower_http=debug
````

````

英文部分同步更新。

- [ ] **Step 8: 提交**

```bash
git add README.md
git commit -m "docs: update README for Rust-only backend"
````

---

### Task 13: 更新 CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 Essential Commands — Development 部分**

移除 Node.js 开发命令，更新为：

```markdown
### Development

- `bun run dev` - Start client in development mode (port 3000)
- `bun run client:dev` - Start only the client (port 3000)
- `bun run build` - Build frontend for production
- `bun run copy-client` - Copy client build to server-rust public directory
```

- [ ] **Step 2: 更新架构部分**

Monorepo Structure 改为三个包（移除 server）：

```markdown
### Monorepo Structure

这是一个 Bun-based monorepo，包含以下工作空间：

1. **`shared/`** - Core types and validation schemas using Zod
2. **`server-rust/`** - Axum + SocketiOxide backend (Rust)
3. **`client/`** - React + Vite frontend
```

- [ ] **Step 3: 移除 Node.js 后端相关的架构描述**

删除所有 "Express.js"、"Socket.IO (Node)"、"Multer" 等仅属于 Node.js 后端的描述。保留与 Rust 后端和前端相关的内容。

- [ ] **Step 4: 更新 Active Technologies**

```markdown
## Active Technologies

- **TypeScript 5.9.3 + Bun 1.x**: 前端运行时和包管理器
- **Rust 1.93 + Axum 0.8 + SocketiOxide 0.15**: 后端实现
- **Zod**: 前端类型验证和 schema 定义
- **React + Vite**: 前端框架和构建工具
- In-memory Map-based storage (server-rust), Multipart for file uploads
```

- [ ] **Step 5: 更新 Code Quality 命令**

移除 `bun run validate` 中的 server 测试引用。更新 `type-check` 说明。

- [ ] **Step 6: 更新 Recent Changes**

添加迁移记录：

```markdown
- **Remove Node.js Backend** (2026-03):
  - 删除 Node.js 后端 (server/)，Rust 后端成为唯一后端
  - 重写 Dockerfile 为多阶段构建（前端 + Rust 后端）
  - 更新所有 CI/CD 流程
  - 简化发布流程为单镜像
```

- [ ] **Step 7: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Rust-only backend"
```

---

### Task 14: 最终验证

- [ ] **Step 1: 验证前端构建**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run build`
Expected: 构建成功

- [ ] **Step 2: 验证 validate:quick 通过**

Run: `cd /home/cc/workspace/cloud-clipboard && bun run validate:quick`
Expected: 所有检查通过

- [ ] **Step 3: 验证 Rust 测试通过**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"`
Expected: 所有测试通过

- [ ] **Step 4: 验证 Docker 构建**

Run: `cd /home/cc/workspace/cloud-clipboard && docker build -t cloud-clipboard-test .`
Expected: 多阶段构建成功（前端 + Rust 后端）

- [ ] **Step 5: 验证 Docker 运行**

Run: `docker run -d --name cc-test -p 3001:3001 cloud-clipboard-test && sleep 3 && curl -f http://localhost:3001/api/health && docker rm -f cc-test`
Expected: 健康检查返回成功

- [ ] **Step 6: 验证没有残留的 server/ 引用**

Run: `cd /home/cc/workspace/cloud-clipboard && grep -r "server/dist\|server:dev\|server:build\|server:start\|server:test\|@cloud-clipboard/server" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.js" --include="*.ts" --include="*.md" . | grep -v node_modules | grep -v server-rust | grep -v ".git/"`
Expected: 无输出（或仅 CHANGELOG 中的历史引用）
