# Cloud Clipboard / 云剪贴板

_中文 | [English](#english)_

一个实时云剪贴板应用程序，允许您使用基于房间的身份验证在不同设备之间安全地共享文本和文件。

## ✨ 功能特性

- 🔐 **安全房间认证** - 输入相同的房间密钥加入并共享数据
- 📝 **文本共享** - 在设备间即时复制和粘贴文本
- 📁 **文件共享** - 上传和下载最大100MB的文件
- 🔗 **外部文件分享** - 创建安全的外部分享链接，支持密码保护和访问控制
  - 📊 **分享管理页面** - 完整的外部分享链接管理界面
  - ⏰ **自定义过期时间** - 可选择1/3/7/15/30天过期时间，默认7天
  - 🔍 **访问日志** - 查看文件下载记录和访问统计
  - 🏷️ **状态筛选** - 按活跃/过期状态筛选分享（简化为双状态）
  - ⚡ **快速操作** - 一键复制链接、直接删除、查看日志
  - 🎯 **简化管理** - 移除中间撤销状态，支持直接删除分享
- 🔄 **实时同步** - 基于WebSocket的即时同步
- 🌐 **P2P支持** - 局域网连接的直接文件传输
- 🎨 **现代UI** - 使用React、Tailwind CSS和shadcn/ui构建的精美界面
  - 🌙 **优雅反馈** - GitHub风格的轻量级提示，不打扰用户操作
  - 📐 **优化布局** - 两行按钮布局，图标完美对齐，间距合理
  - ⏰ **友好时间** - 智能时间格式：刚刚、X分钟前、昨天 HH:MM、MM月DD日
  - 🎯 **统一交互** - 文本和文件消息操作按钮统一移至右上角，简洁优雅
- ⚡ **快速可靠** - 使用Bun、TypeScript构建，具有严格的类型检查
- 📱 **跨平台** - 适用于桌面、平板和移动设备
- 🔄 **持久会话** - 浏览器刷新后自动重新加入房间
- ⏰ **智能管理** - 2小时无活动自动登出，房间自动销毁和文件清理
- 👤 **用户名去重** - 自动处理重复用户名，添加随机后缀
- 🗂️ **文件管理** - 12小时文件保留策略，自动清理过期文件
- 🔔 **系统通知** - 文件上传/删除、房间销毁等事件的清晰通知
- 🐛 **调试日志** - 可配置的前端和后端调试日志系统
- 🌍 **多语言** - 支持中文和英文界面
- 🔒 **房间密码** - 可选的房间密码保护功能
- 🧪 **全面测试** - 单元测试、集成测试和E2E测试覆盖
- 📲 **PWA 支持** - 可安装为应用，支持离线使用，自动更新

## 🏗️ 架构

这个项目采用monorepo架构，包含三个主要包：

- **`shared/`** - 公共类型、模式和工具（TypeScript + Zod）
- **`server-rust/`** - 后端 API 和 WebSocket 服务器（Rust + Axum + SocketiOxide）
- **`client/`** - 前端 React 应用程序（React + Vite + Tailwind CSS）

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

### 前端

- **框架**: React 18
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **UI组件**: shadcn/ui (Radix UI)
- **WebSocket客户端**: Socket.IO Client
- **验证**: Zod schemas
- **PWA**: Vite PWA Plugin + Workbox
- **测试**: Vitest + Playwright
- **代码质量**: ESLint + Prettier
- **国际化**: react-i18next

### 共享

- **类型系统**: 严格模式的TypeScript
- **验证**: Zod schemas
- **工具**: 共享工具函数

## 🚀 快速开始

### 前置条件

- 系统中安装了 [Bun](https://bun.sh)

### 安装

1. 克隆仓库
2. 安装依赖：
   ```bash
   bun install
   ```

### 开发

启动客户端开发模式：

```bash
bun run dev
```

客户端运行在 http://localhost:3000，开发时通过 Vite 代理连接到后端。

Rust 后端需要单独通过 Docker 启动：

```bash
cd server-rust && docker build -t cloud-clipboard-rust .
# 先复制前端构建产物
bun run copy-client
docker run -p 3001:3001 -v $(pwd)/server-rust/uploads:/app/uploads cloud-clipboard-rust
```

### 生产环境

使用 Docker 构建完整应用（前端 + 后端）：

```bash
docker build -t cloud-clipboard .
docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard
```

> **注意**: 生产环境下，前端和后端会运行在同一个端口（默认3001），无需分别部署。

## 📖 使用方法

### 房间内共享

1. **加入房间**: 输入房间密钥（任意字符串）和您的姓名
2. **共享文本**: 输入或粘贴文本并点击发送
3. **共享文件**: 点击文件按钮上传文件（最大100MB）
4. **复制文本**: 点击任何文本消息上的复制按钮
5. **下载文件**: 点击文件消息上的下载按钮
6. **多用户协作**: 与他人共享相同的房间密钥进行协作

### 外部文件分享

1. **创建分享链接**: 在文件消息上点击"创建分享"按钮
2. **设置访问控制**:
   - 可选择设置密码保护（自动生成6位安全密码）
   - 设置过期时间（1-30天，默认7天）
3. **分享文件**: 获取安全的分享链接，可分享给任何人
4. **外部访问**: 访问者可通过分享链接直接下载文件
5. **管理分享**: 查看访问日志、获取链接详细信息或直接删除分享

## 🔧 调试功能

### 前端调试

在浏览器控制台中使用以下命令：

```javascript
// 启用调试模式
cloudClipboardDebug.enable();

// 设置日志级别
cloudClipboardDebug.setLevel("debug"); // debug, info, warn, error

// 查看配置
cloudClipboardDebug.getConfig();

// 关闭调试
cloudClipboardDebug.disable();
```

### 后端日志配置

通过环境变量配置 Rust 后端日志：

```bash
export RUST_LOG=cloud_clipboard_server=debug,tower_http=debug
```

## 🔒 安全特性

- **房间隔离**: 不同房间的用户无法看到彼此的数据
- **无持久存储**: 消息仅在会话期间保存在内存中
- **会话持久**: 浏览器刷新后自动重新加入房间
- **智能清理**: 用户离线或无活动时自动清理数据
- **安全头部**: Tower-HTTP 提供安全头部（CSP、HSTS、X-Frame-Options 等）
- **输入验证**: 所有数据都使用Zod schemas验证
- **CORS保护**: 可配置的CORS设置

## 📁 文件传输

### 房间内传输

- **服务器上传**: 文件上传到服务器进行共享
- **智能管理**: 按房间分组存储，支持自动清理
- **保留策略**: 12小时最大保留时间，房间销毁时自动删除
- **系统通知**: 文件上传、删除操作的实时通知
- **P2P传输**: 局域网中设备间直接传输（WebRTC）
- **大小限制**: 最大文件大小100MB
- **类型支持**: 支持所有文件类型

### 外部文件分享

- **安全链接**: 创建带唯一ID的安全分享链接（8-10字符）
- **密码保护**: 自动生成6位安全密码，无需用户记忆复杂密码
- **过期控制**: 1-30天可配置过期时间，默认7天
- **访问跟踪**: 详细的访问日志记录（IP地址、时间戳、成功/失败）
- **速率限制**: 独立的下载速率限制保护
- **简化管理**: 支持直接删除分享，无需中间撤销状态
- **安全传输**: HTTPS加密传输

## 🌍 环境变量

### 服务器

- `PORT` - 服务器端口（默认：3001）
- `CLIENT_URL` - 前端URL用于CORS（默认：\*）
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

### 客户端

- `VITE_SERVER_URL` - 后端服务器URL（默认：http://localhost:3001）

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
docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"  # 测试

# 图标管理
bun run icons:generate         # 生成Web图标

# 版本管理
bun run version:check          # 检查版本一致性
bun run version:report         # 生成版本报告
bun run version:outdated       # 检查过期依赖

# 发布管理
bun run release:patch          # 发布补丁版本
bun run release:minor          # 发布次要版本
bun run release:major          # 发布主要版本
bun run release:dry-run        # 预览发布更改
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
- 🔗 **External File Sharing** - Create secure external share links with password protection and access control
  - 📊 **Share Management** - Complete external share link management interface
  - ⏰ **Expiration Control** - Configurable expiration time with presets (1/3/7/15/30 days, default: 7)
  - 🔍 **Access Logs** - View download records and access statistics
  - 🏷️ **Status Filtering** - Filter shares by active/expired status (simplified dual-state system)
  - ⚡ **Quick Actions** - Copy links, direct delete, view logs
  - 🎯 **Simplified Management** - Removed intermediate revoked state, direct delete supported
- 🔄 **Real-time Sync** - WebSocket-based instant synchronization
- 🌐 **P2P Support** - Direct file transfer for local network connections
- 🎨 **Modern UI** - Beautiful interface built with React, Tailwind CSS, and shadcn/ui
  - 🌙 **Elegant Feedback** - GitHub-style lightweight tooltips, non-intrusive user experience
  - 📐 **Optimized Layout** - Two-row button layout with perfect icon alignment
  - ⏰ **Friendly Timestamps** - Smart time formats: "just now", "X min ago", "Yesterday HH:MM", "MMM DD"
  - 🎯 **Unified Interaction** - Text and file message action buttons unified in top-right corner
- ⚡ **Fast & Reliable** - Built with Bun, TypeScript, and strict type checking
- 📱 **Cross-Platform** - Works on desktop, tablet, and mobile devices
- 🔄 **Session Persistence** - Automatically rejoin rooms after browser refresh
- ⏰ **Smart Management** - 2-hour inactivity auto-logout, room auto-destruction and file cleanup
- 👤 **Username Deduplication** - Automatic handling of duplicate usernames with random suffixes
- 🗂️ **File Management** - 12-hour file retention policy with automatic cleanup
- 🔔 **System Notifications** - Clear notifications for file uploads/deletions, room destruction events
- 🐛 **Debug Logging** - Configurable frontend and backend debug logging system
- 🌍 **Multilingual** - Support for Chinese and English interfaces
- 🔒 **Room Password** - Optional room password protection feature
- 🧪 **Comprehensive Testing** - Unit tests, integration tests, and E2E tests
- 📲 **PWA Support** - Installable as an app, offline support, auto-update

## 🏗️ Architecture

This project is built as a monorepo with three main packages:

- **`shared/`** - Common types, schemas, and utilities (TypeScript + Zod)
- **`server-rust/`** - Backend API and WebSocket server (Rust + Axum + SocketiOxide)
- **`client/`** - Frontend React application (React + Vite + Tailwind CSS)

## 🛠️ Tech Stack

### Backend

- **Language**: Rust 1.93+
- **Framework**: Axum 0.8
- **WebSockets**: SocketiOxide 0.15
- **Async Runtime**: Tokio
- **Serialization**: Serde + serde_json
- **Security**: bcrypt encryption, SHA-256 hashing, secure random
- **Middleware**: Tower + tower-http (CORS, compression, rate limiting)
- **Testing**: 15 test modules with comprehensive unit and integration test coverage
- **Performance**: High performance and memory safety

### Frontend

- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI)
- **WebSocket Client**: Socket.IO Client
- **Validation**: Zod schemas
- **PWA**: Vite PWA Plugin + Workbox

### Shared

- **Type System**: TypeScript with strict mode
- **Validation**: Zod schemas
- **Utilities**: Shared utility functions
- **Testing**: Vitest + Playwright
- **Code Quality**: ESLint + Prettier
- **Internationalization**: react-i18next

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed on your system

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

### Development

Start the client in development mode:

```bash
bun run dev
```

The client runs on http://localhost:3000 and connects to the backend via Vite proxy during development.

The Rust backend needs to be started separately via Docker:

```bash
cd server-rust && docker build -t cloud-clipboard-rust .
# Copy frontend build artifacts first
bun run copy-client
docker run -p 3001:3001 -v $(pwd)/server-rust/uploads:/app/uploads cloud-clipboard-rust
```

### Production

Build the full application (frontend + backend) with Docker:

```bash
docker build -t cloud-clipboard .
docker run -p 3001:3001 -v ./uploads:/app/uploads cloud-clipboard
```

> **Note**: In production, frontend and backend run on the same port (default 3001), no separate deployment needed.

## 📖 Usage

### In-Room Sharing

1. **Join a Room**: Enter a room key (any string) and your name
2. **Share Text**: Type or paste text and click Send
3. **Share Files**: Click the File button to upload files (max 100MB)
4. **Copy Text**: Click the Copy button on any text message
5. **Download Files**: Click the Download button on file messages
6. **Multiple Users**: Share the same room key with others to collaborate

### External File Sharing

1. **Create Share Link**: Click "Create Share" on any file message
2. **Set Access Control**:
   - Optionally set password protection (auto-generated 6-character secure password)
   - Set expiration time (1-30 days, default: 7 days)
3. **Share File**: Get a secure share link to share with anyone
4. **External Access**: Recipients can download files directly via the share link
5. **Manage Shares**: View access logs, get share details, or delete share directly

## 🔧 Debug Features

### Frontend Debug

Use the following commands in the browser console:

```javascript
// Enable debug mode
cloudClipboardDebug.enable();

// Set log level
cloudClipboardDebug.setLevel("debug"); // debug, info, warn, error

// Check configuration
cloudClipboardDebug.getConfig();

// Disable debug
cloudClipboardDebug.disable();
```

### Backend Logging Configuration

Configure Rust backend logging via environment variables:

```bash
export RUST_LOG=cloud_clipboard_server=debug,tower_http=debug
```

## 🔒 Security Features

- **Room Isolation**: Users in different rooms cannot see each other's data
- **No Persistent Storage**: Messages are only kept in memory during the session
- **Session Persistence**: Automatically rejoin rooms after browser refresh
- **Smart Cleanup**: Automatic data cleanup when users go offline or inactive
- **Secure Headers**: Tower-HTTP provides security headers (CSP, HSTS, X-Frame-Options, etc.)
- **Input Validation**: All data is validated using Zod schemas
- **CORS Protection**: Configurable CORS settings

## 📁 File Transfer

### In-Room Transfer

- **Server Upload**: Files are uploaded to the server for sharing
- **Smart Management**: Room-based file grouping with automatic cleanup
- **Retention Policy**: 12-hour maximum retention, auto-delete on room destruction
- **System Notifications**: Real-time notifications for file upload/delete operations
- **P2P Transfer**: Direct device-to-device transfer for local network (WebRTC)
- **Size Limit**: Maximum file size of 100MB
- **Type Support**: All file types are supported

### External File Sharing

- **Secure Links**: Create secure share links with unique IDs (8-10 characters)
- **Password Protection**: Auto-generated 6-character secure passwords, no complex requirements
- **Expiration Control**: Configurable expiration time from 1-30 days (default: 7 days)
- **Access Tracking**: Detailed access logs with IP address, timestamp, and success/failure status
- **Rate Limiting**: Independent download rate limiting for protection
- **Simplified Management**: Direct delete shares, no intermediate revoked state
- **Secure Transmission**: HTTPS encrypted transmission

## 🌍 Environment Variables

### Server

- `PORT` - Server port (default: 3001)
- `CLIENT_URL` - Frontend URL for CORS (default: \*)
- `ALLOW_HTTP` - Allow HTTP connections (default: false)
- `UPLOAD_DIR` - File upload directory (default: ./uploads)
- `STATIC_DIR` - Static file directory (default: ./public)
- `MAX_FILE_SIZE` - Max file size (default: 104857600 = 100MB)
- `ROOM_CLEANUP_INTERVAL_SECONDS` - Room cleanup interval in seconds (default: 60)
- `FILE_RETENTION_HOURS` - File retention period (default: 12 hours)
- `FILE_CLEANUP_INTERVAL_SECONDS` - File cleanup interval in seconds (default: 600)
- `RATE_LIMIT_WINDOW` - Rate limit window in seconds (default: 60)
- `RATE_LIMIT_MAX_REQUESTS` - Max requests per window (default: 500)
- `PUBLIC_DOWNLOAD_RATE_LIMIT` - Max public download requests per minute (default: 20)
- `MAX_PINNED_ROOMS` - Max pinned rooms (default: 50)
- `BASE_PATH` - Sub-path deployment (optional, e.g., /clipboard)
- `PUBLIC_URL` - Public access URL for generating share links (e.g., https://clipboard.example.com)
- `RUST_LOG` - Log level (default: cloud_clipboard_server=info,tower_http=info)

### Client

- `VITE_SERVER_URL` - Backend server URL (default: http://localhost:3001)

## 📋 Development Commands

```bash
# Install dependencies
bun install

# Start frontend development server
bun run dev

# Build frontend
bun run build

# Run type checking
bun run type-check

# Run linting
bun run lint
bun run lint:fix               # Auto-fix ESLint errors

# Code formatting
bun run format                 # Format code with Prettier
bun run format:check           # Check code formatting

# Rust backend (requires Docker)
cd server-rust && docker build -t cloud-clipboard-rust .                    # Build
docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test --all-features"  # Test

# Icon management
bun run icons:generate         # Generate web icons

# Version management
bun run version:check          # Check version consistency
bun run version:report         # Generate version report
bun run version:outdated       # Check outdated dependencies

# Release management
bun run release:patch          # Create patch release
bun run release:minor          # Create minor release
bun run release:major          # Create major release
bun run release:dry-run        # Preview release changes
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
