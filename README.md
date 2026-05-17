# Cloud Clipboard / 云剪贴板

_中文 | [English](#english)_

一个实时云剪贴板应用程序，允许您使用基于房间的身份验证在不同设备之间安全地共享文本和文件。

## ✨ 功能特性

- 🔐 **安全房间认证** - 输入相同的房间密钥加入并共享数据
- 📝 **文本共享** - 在设备间即时复制和粘贴文本
- 📁 **文件共享** - 上传和下载最大100MB的文件
- ↩️ **消息撤回** - 支持撤回已发送的消息
- 🔗 **消息链接识别** - 自动识别消息中的 URL 并渲染为可点击链接
- 🔗 **外部文件分享** - 创建安全的外部分享链接，支持提取码保护和访问控制
  - ⏰ **自定义过期时间** - 可选择1/3/7/15/30天过期时间，默认7天
  - 🔍 **访问日志** - 查看文件下载记录和访问统计
  - 🏷️ **状态筛选** - 按活跃/过期状态筛选分享
  - ⚡ **快速操作** - 一键复制链接、直接删除、查看日志
- 📌 **房间固定** - 置顶常用房间，快速访问，消息持久化保存
- 🔗 **房间分享链接** - 生成房间邀请链接，方便他人加入
- 🔄 **实时同步** - 基于WebSocket的即时同步
- 🌐 **P2P支持** - 局域网连接的直接文件传输
- 🎨 **现代UI** - 使用React、Tailwind CSS和shadcn/ui构建的精美界面
  - 🌙 **优雅反馈** - GitHub风格的轻量级提示
  - ⏰ **友好时间** - 智能时间格式：刚刚、X分钟前、昨天 HH:MM
  - 🎯 **统一交互** - 消息操作按钮统一至右上角
  - 📱 **移动端优化** - 键盘适配、触摸优化、安全区域适配
- ⚡ **快速可靠** - 使用Bun、TypeScript构建，具有严格的类型检查
- 📱 **跨平台** - 适用于桌面、平板和移动设备
- 🔄 **持久会话** - 浏览器刷新后自动重新加入房间
- ⏰ **智能管理** - 2小时无活动自动登出，房间自动销毁和文件清理
- 👤 **用户名去重** - 自动处理重复用户名，添加随机后缀
- 🗂️ **文件管理** - 12小时文件保留策略，自动清理过期文件
- 🔔 **系统通知** - 文件上传/删除、房间销毁等事件的清晰通知
- 🌍 **多语言** - 支持中文和英文界面
- 🔒 **房间密码** - 可选的房间密码保护功能
- 📲 **PWA 支持** - 可安装为应用，支持离线使用，自动更新
- 🧪 **全面测试** - 单元测试、集成测试和安全测试覆盖

## 🏗️ 架构

这个项目采用monorepo架构，包含以下包：

- **`shared/`** - 公共类型、模式和工具（TypeScript + Zod 4）
- **`server-rust/`** - 后端 API 和 WebSocket 服务器（Rust + Axum + SocketiOxide）
- **`client/`** - 前端 React 应用程序（React 19 + Vite 7 + Tailwind CSS）

## 🛠️ 技术栈

### 后端

- **语言**: Rust (edition 2024, MSRV 1.87)
- **框架**: Axum 0.8
- **WebSocket**: SocketiOxide 0.15
- **异步运行时**: Tokio
- **序列化**: Serde + serde_json
- **安全**: bcrypt 加密、SHA-256 哈希
- **中间件**: Tower + tower-http（CORS、压缩、限流）
- **测试**: 15 个测试模块，完善的单元测试和集成测试覆盖

### 前端

- **框架**: React 19
- **构建工具**: Vite 7
- **样式**: Tailwind CSS
- **UI组件**: shadcn/ui (Radix UI)
- **WebSocket客户端**: Socket.IO Client
- **验证**: Zod 4 schemas
- **虚拟列表**: @tanstack/react-virtual
- **PWA**: Vite PWA Plugin + Workbox
- **测试**: Vitest + Playwright
- **代码质量**: ESLint + Prettier
- **国际化**: react-i18next

### 共享

- **类型系统**: TypeScript 5.9（严格模式）
- **验证**: Zod 4 schemas
- **工具**: 共享工具函数

## 🚀 快速开始

### 前置条件

- 系统中安装了 [Bun](https://bun.sh)

### 安装

```bash
git clone <repo-url>
cd cloud-clipboard
bun install
```

### 开发

```bash
bun run dev
```

客户端运行在 http://localhost:3000，开发时通过 Vite 代理连接到后端。

Rust 后端需要单独通过 Docker 启动：

```bash
cd server-rust && docker build -t cloud-clipboard-rust .
bun run copy-client
docker run -p 3001:3001 -v $(pwd)/server-rust/uploads:/app/uploads cloud-clipboard-rust
```

### 生产环境

```bash
docker build -t cloud-clipboard .
docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard
```

> **注意**: 生产环境下，前端和后端运行在同一个端口（默认3001），无需分别部署。

## 📖 使用方法

1. **加入房间**: 输入房间密钥和您的姓名
2. **共享文本**: 输入或粘贴文本并点击发送
3. **共享文件**: 点击文件按钮上传文件（最大100MB）
4. **消息撤回**: 点击已发送消息的撤回按钮
5. **外部分享**: 在文件消息上点击"创建分享"按钮，生成带提取码保护的分享链接
6. **房间固定**: 置顶常用房间，方便快速访问

## 🔒 安全特性

- **房间隔离**: 不同房间的用户无法看到彼此的数据
- **无持久存储**: 消息仅在会话期间保存在内存中
- **智能清理**: 用户离线或无活动时自动清理数据
- **安全头部**: Tower-HTTP 提供安全头部（CSP、HSTS、X-Frame-Options 等）
- **输入验证**: 所有数据都使用 Zod schemas 验证
- **CORS保护**: 可配置的CORS设置，生产模式收紧
- **分享安全**: 分享链接不存储明文提取码，P2P 信令跨房间校验

## 🌍 环境变量

### 服务器

| 变量                                | 默认值                      | 说明                        |
| ----------------------------------- | --------------------------- | --------------------------- |
| `PORT`                              | 3001                        | 服务器端口                  |
| `CLIENT_URL`                        | \*                          | 前端URL用于CORS             |
| `ALLOW_HTTP`                        | false                       | 允许HTTP连接                |
| `UPLOAD_DIR`                        | ./uploads                   | 文件上传目录                |
| `STATIC_DIR`                        | ./public                    | 静态文件目录                |
| `MAX_FILE_SIZE`                     | 104857600                   | 最大文件大小（100MB）       |
| `MAX_TOTAL_STORAGE_SIZE`            | 1073741824                  | 存储配额上限（1GB）         |
| `FILE_RETENTION_HOURS`              | 12                          | 文件保留时间（小时）        |
| `ROOM_CLEANUP_INTERVAL_SECONDS`     | 60                          | 房间清理间隔（秒）          |
| `FILE_CLEANUP_INTERVAL_SECONDS`     | 600                         | 文件清理间隔（秒）          |
| `CLEANUP_ORPHANED_FILES_AT_STARTUP` | true                        | 启动时清理孤立文件          |
| `RATE_LIMIT_WINDOW`                 | 60                          | 速率限制窗口（秒）          |
| `RATE_LIMIT_MAX_REQUESTS`           | 500                         | 每窗口最大请求数            |
| `STRICT_RATE_LIMIT_MAX_REQUESTS`    | 50                          | 严格速率限制最大请求数      |
| `PUBLIC_DOWNLOAD_RATE_LIMIT`        | 20                          | 公开下载每分钟最大请求数    |
| `DOWNLOAD_TIMEOUT`                  | 30                          | 下载超时（秒）              |
| `MAX_DOWNLOAD_BYTES_PER_MINUTE`     | MAX_FILE_SIZE×10            | 每分钟最大下载字节数        |
| `MAX_PINNED_ROOMS`                  | 50                          | 最大固定房间数              |
| `BASE_PATH`                         | -                           | 子路径部署（如 /clipboard） |
| `PUBLIC_URL`                        | -                           | 公网地址，用于生成分享链接  |
| `RUST_LOG`                          | cloud_clipboard_server=info | 日志级别                    |

## 📋 开发命令

```bash
bun install                      # 安装依赖
bun run dev                      # 启动开发服务器
bun run build                    # 构建前端
bun run copy-client              # 复制构建产物到 server-rust

# 代码质量
bun run lint                     # ESLint 检查
bun run lint:fix                 # 自动修复 ESLint 错误
bun run format                   # Prettier 格式化
bun run format:check             # 检查格式
bun run type-check               # TypeScript 类型检查
bun run validate                 # 完整验证（格式+lint+类型+测试）
bun run validate:quick           # 快速验证（格式+lint+类型）

# 测试
bun run test                     # 运行所有测试
bun run test:watch               # 监听模式
bun run test:e2e                 # E2E 测试
bun run test:coverage            # 前端覆盖率
bun run test:coverage:all        # 前端+后端覆盖率

# Rust 后端（需要 Docker）
docker run --rm -v cargo-registry:/usr/local/cargo/registry \
  -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"

# 图标 & 版本管理
bun run icons:generate           # 生成Web图标
bun run version:check            # 检查版本一致性
bun run release:patch            # 发布补丁版本
bun run release:minor            # 发布次要版本
bun run release:major            # 发布主要版本
```

## 🤝 贡献

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开Pull Request

## 📄 许可证

本项目是开源项目，使用 [MIT License](LICENSE) 许可证。

---

# English

_[中文](#cloud-clipboard--云剪贴板) | English_

A real-time cloud clipboard application that allows you to share text and files across different devices securely using room-based authentication.

## ✨ Features

- 🔐 **Secure Room Authentication** - Enter the same room key to join and share data
- 📝 **Text Sharing** - Copy and paste text instantly across devices
- 📁 **File Sharing** - Upload and download files up to 100MB
- ↩️ **Message Recall** - Recall sent messages
- 🔗 **Link Detection** - Auto-detect URLs in messages and render as clickable links
- 🔗 **External File Sharing** - Create secure external share links with access code protection and access control
  - ⏰ **Expiration Control** - Configurable expiration with presets (1/3/7/15/30 days, default: 7)
  - 🔍 **Access Logs** - View download records and access statistics
  - 🏷️ **Status Filtering** - Filter shares by active/expired status
  - ⚡ **Quick Actions** - Copy links, direct delete, view logs
- 📌 **Room Pinning** - Pin frequently used rooms for quick access, messages persisted to SQLite
- 🔗 **Room Share Links** - Generate room invitation links for easy joining
- 🔄 **Real-time Sync** - WebSocket-based instant synchronization
- 🌐 **P2P Support** - Direct file transfer for local network connections
- 🎨 **Modern UI** - Beautiful interface built with React, Tailwind CSS, and shadcn/ui
  - 🌙 **Elegant Feedback** - GitHub-style lightweight tooltips
  - ⏰ **Friendly Timestamps** - Smart time formats: "just now", "X min ago", "Yesterday HH:MM"
  - 🎯 **Unified Interaction** - Message action buttons unified in top-right corner
  - 📱 **Mobile Optimized** - Keyboard adaptation, touch optimization, safe area support
- ⚡ **Fast & Reliable** - Built with Bun, TypeScript, and strict type checking
- 📱 **Cross-Platform** - Works on desktop, tablet, and mobile devices
- 🔄 **Session Persistence** - Automatically rejoin rooms after browser refresh
- ⏰ **Smart Management** - 2-hour inactivity auto-logout, room auto-destruction and file cleanup
- 👤 **Username Deduplication** - Automatic handling of duplicate usernames with random suffixes
- 🗂️ **File Management** - 12-hour file retention policy with automatic cleanup
- 🔔 **System Notifications** - Clear notifications for file uploads/deletions, room destruction events
- 🌍 **Multilingual** - Support for Chinese and English interfaces
- 🔒 **Room Password** - Optional room password protection feature
- 📲 **PWA Support** - Installable as an app, offline support, auto-update
- 🧪 **Comprehensive Testing** - Unit tests, integration tests, and security tests

## 🏗️ Architecture

This project is built as a monorepo with the following packages:

- **`shared/`** - Common types, schemas, and utilities (TypeScript + Zod 4)
- **`server-rust/`** - Backend API and WebSocket server (Rust + Axum + SocketiOxide)
- **`client/`** - Frontend React application (React 19 + Vite 7 + Tailwind CSS)

## 🛠️ Tech Stack

### Backend

- **Language**: Rust (edition 2024, MSRV 1.87)
- **Framework**: Axum 0.8
- **WebSockets**: SocketiOxide 0.15
- **Async Runtime**: Tokio
- **Serialization**: Serde + serde_json
- **Security**: bcrypt encryption, SHA-256 hashing
- **Middleware**: Tower + tower-http (CORS, compression, rate limiting)
- **Testing**: 15 test modules with comprehensive unit and integration test coverage

### Frontend

- **Framework**: React 19
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI)
- **WebSocket Client**: Socket.IO Client
- **Validation**: Zod 4 schemas
- **Virtual List**: @tanstack/react-virtual
- **PWA**: Vite PWA Plugin + Workbox
- **Testing**: Vitest + Playwright
- **Code Quality**: ESLint + Prettier
- **Internationalization**: react-i18next

### Shared

- **Type System**: TypeScript 5.9 (strict mode)
- **Validation**: Zod 4 schemas
- **Utilities**: Shared utility functions

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed on your system

### Installation

```bash
git clone <repo-url>
cd cloud-clipboard
bun install
```

### Development

```bash
bun run dev
```

The client runs on http://localhost:3000 and connects to the backend via Vite proxy during development.

The Rust backend needs to be started separately via Docker:

```bash
cd server-rust && docker build -t cloud-clipboard-rust .
bun run copy-client
docker run -p 3001:3001 -v $(pwd)/server-rust/uploads:/app/uploads cloud-clipboard-rust
```

### Production

```bash
docker build -t cloud-clipboard .
docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard
```

> **Note**: In production, frontend and backend run on the same port (default 3001), no separate deployment needed.

## 📖 Usage

1. **Join a Room**: Enter a room key and your name
2. **Share Text**: Type or paste text and click Send
3. **Share Files**: Click the File button to upload files (max 100MB)
4. **Recall Messages**: Click the recall button on sent messages
5. **External Sharing**: Click "Create Share" on file messages to generate access code-protected share links
6. **Pin Rooms**: Pin frequently used rooms for quick access

## 🔒 Security Features

- **Room Isolation**: Users in different rooms cannot see each other's data
- **No Persistent Storage**: Messages are only kept in memory during the session
- **Smart Cleanup**: Automatic data cleanup when users go offline or inactive
- **Secure Headers**: Tower-HTTP provides security headers (CSP, HSTS, X-Frame-Options, etc.)
- **Input Validation**: All data is validated using Zod schemas
- **CORS Protection**: Configurable CORS settings, tightened in production mode
- **Share Security**: Share links don't store plaintext access codes, P2P signaling cross-room validation

## 🌍 Environment Variables

### Server

| Variable                            | Default                     | Description                             |
| ----------------------------------- | --------------------------- | --------------------------------------- |
| `PORT`                              | 3001                        | Server port                             |
| `CLIENT_URL`                        | \*                          | Frontend URL for CORS                   |
| `ALLOW_HTTP`                        | false                       | Allow HTTP connections                  |
| `UPLOAD_DIR`                        | ./uploads                   | File upload directory                   |
| `STATIC_DIR`                        | ./public                    | Static file directory                   |
| `MAX_FILE_SIZE`                     | 104857600                   | Max file size (100MB)                   |
| `MAX_TOTAL_STORAGE_SIZE`            | 1073741824                  | Storage quota limit (1GB)               |
| `FILE_RETENTION_HOURS`              | 12                          | File retention period (hours)           |
| `ROOM_CLEANUP_INTERVAL_SECONDS`     | 60                          | Room cleanup interval (seconds)         |
| `FILE_CLEANUP_INTERVAL_SECONDS`     | 600                         | File cleanup interval (seconds)         |
| `CLEANUP_ORPHANED_FILES_AT_STARTUP` | true                        | Clean orphaned files at startup         |
| `RATE_LIMIT_WINDOW`                 | 60                          | Rate limit window (seconds)             |
| `RATE_LIMIT_MAX_REQUESTS`           | 500                         | Max requests per window                 |
| `STRICT_RATE_LIMIT_MAX_REQUESTS`    | 50                          | Strict rate limit max requests          |
| `PUBLIC_DOWNLOAD_RATE_LIMIT`        | 20                          | Max public download requests per minute |
| `DOWNLOAD_TIMEOUT`                  | 30                          | Download timeout (seconds)              |
| `MAX_DOWNLOAD_BYTES_PER_MINUTE`     | MAX_FILE_SIZE×10            | Max download bytes per minute           |
| `MAX_PINNED_ROOMS`                  | 50                          | Max pinned rooms                        |
| `BASE_PATH`                         | -                           | Sub-path deployment (e.g., /clipboard)  |
| `PUBLIC_URL`                        | -                           | Public URL for generating share links   |
| `RUST_LOG`                          | cloud_clipboard_server=info | Log level                               |

## 📋 Development Commands

```bash
bun install                      # Install dependencies
bun run dev                      # Start development server
bun run build                    # Build frontend
bun run copy-client              # Copy build artifacts to server-rust

# Code quality
bun run lint                     # ESLint check
bun run lint:fix                 # Auto-fix ESLint errors
bun run format                   # Prettier formatting
bun run format:check             # Check formatting
bun run type-check               # TypeScript type check
bun run validate                 # Full validation (format+lint+type+tests)
bun run validate:quick           # Quick validation (format+lint+type)

# Testing
bun run test                     # Run all tests
bun run test:watch               # Watch mode
bun run test:e2e                 # E2E tests
bun run test:coverage            # Frontend coverage
bun run test:coverage:all        # Frontend + backend coverage

# Rust backend (requires Docker)
docker run --rm -v cargo-registry:/usr/local/cargo/registry \
  -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"

# Icons & Version management
bun run icons:generate           # Generate web icons
bun run version:check            # Check version consistency
bun run release:patch            # Create patch release
bun run release:minor            # Create minor release
bun run release:major            # Create major release
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
