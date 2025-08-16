# Cloud Clipboard / 云剪贴板

*中文 | [English](#english)*

一个实时云剪贴板应用程序，允许您使用基于房间的身份验证在不同设备之间安全地共享文本和文件。

## ✨ 功能特性

- 🔐 **安全房间认证** - 输入相同的房间密钥加入并共享数据
- 📝 **文本共享** - 在设备间即时复制和粘贴文本
- 📁 **文件共享** - 上传和下载最大100MB的文件
- 🔄 **实时同步** - 基于WebSocket的即时同步
- 🌐 **P2P支持** - 局域网连接的直接文件传输
- 🎨 **现代UI** - 使用React、Tailwind CSS和shadcn/ui构建的精美界面
- ⚡ **快速可靠** - 使用Bun、TypeScript构建，具有严格的类型检查
- 📱 **跨平台** - 适用于桌面、平板和移动设备
- 🖥️ **桌面应用** - 基于Tauri的原生桌面应用，支持自动剪切板监听
- 🔄 **持久会话** - 浏览器刷新后自动重新加入房间
- ⏰ **智能管理** - 2小时无活动自动登出，房间自动销毁和文件清理
- 👤 **用户名去重** - 自动处理重复用户名，添加随机后缀
- 🗂️ **文件管理** - 12小时文件保留策略，自动清理过期文件
- 🔔 **系统通知** - 文件上传/删除、房间销毁等事件的清晰通知
- 🐛 **调试日志** - 可配置的前端和后端调试日志系统
- 🌍 **多语言** - 支持中文和英文界面

## 🏗️ 架构

这个项目采用monorepo架构，包含四个主要包：

- **`shared/`** - 公共类型、模式和工具（TypeScript + Zod）
- **`server/`** - 后端API和WebSocket服务器（Node.js + Express + Socket.IO）
- **`client/`** - 前端React应用程序（React + Vite + Tailwind CSS）
- **`desktop/`** - 桌面应用程序（Tauri + Rust，支持Windows、macOS、Linux）

## 🛠️ 技术栈

### 后端
- **运行时**: Bun
- **框架**: Express.js
- **WebSocket**: Socket.IO
- **验证**: Zod schemas
- **安全**: Helmet, CORS
- **文件上传**: Multer

### 前端
- **框架**: React 18
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **UI组件**: shadcn/ui (Radix UI)
- **WebSocket客户端**: Socket.IO Client
- **验证**: Zod schemas

### 共享
- **类型系统**: 严格模式的TypeScript
- **验证**: Zod schemas
- **工具**: 共享工具函数

### 桌面
- **框架**: Tauri (Rust + WebView)
- **前端集成**: React + TypeScript 复用
- **系统功能**: 剪切板监听、系统通知、自动启动
- **跨平台**: Windows、macOS、Linux 支持

## 🚀 快速开始

### 前置条件
- 系统中安装了 [Bun](https://bun.sh)
- （可选）桌面应用需要 [Rust](https://rustup.rs/) 环境

### 安装

1. 克隆仓库
2. 安装依赖：
   ```bash
   bun install
   ```

3. 构建共享包：
   ```bash
   bun run shared:build
   ```

### 开发

同时启动服务器和客户端开发模式：
```bash
bun run dev
```

或者分别启动：

**服务器** (运行在 http://localhost:3001)：
```bash
bun run server:dev
```

**客户端** (运行在 http://localhost:3000)：
```bash
bun run client:dev
```

**桌面应用**：
```bash
bun run desktop:dev
```

### 生产环境

构建所有包（包含统一部署）：
```bash
bun run build
```

启动统一服务（前端+后端）：
```bash
bun run start
```

构建桌面应用：
```bash
bun run desktop:build
```

> **注意**: 生产环境下，前端和后端会运行在同一个端口（默认3001），无需分别部署。

## 📖 使用方法

1. **加入房间**: 输入房间密钥（任意字符串）和您的姓名
2. **共享文本**: 输入或粘贴文本并点击发送
3. **共享文件**: 点击文件按钮上传文件（最大100MB）
4. **复制文本**: 点击任何文本消息上的复制按钮
5. **下载文件**: 点击文件消息上的下载按钮
6. **多用户协作**: 与他人共享相同的房间密钥进行协作

## 🔧 调试功能

### 前端调试

在浏览器控制台中使用以下命令：

```javascript
// 启用调试模式
cloudClipboardDebug.enable()

// 设置日志级别
cloudClipboardDebug.setLevel("debug")  // debug, info, warn, error

// 查看配置
cloudClipboardDebug.getConfig()

// 关闭调试
cloudClipboardDebug.disable()
```

### 后端日志配置

通过环境变量配置服务器日志：

```bash
export LOG_LEVEL=DEBUG     # DEBUG, INFO, WARN, ERROR, SILENT
export LOG_COLORS=false    # 禁用彩色输出
export LOG_TIMESTAMPS=false # 禁用时间戳
bun run server:dev
```

详细使用说明请查看：[调试日志使用指南](./docs/调试日志使用指南.md)

## 🔒 安全特性

- **房间隔离**: 不同房间的用户无法看到彼此的数据
- **无持久存储**: 消息仅在会话期间保存在内存中
- **会话持久**: 浏览器刷新后自动重新加入房间
- **智能清理**: 用户离线或无活动时自动清理数据
- **安全头部**: Helmet.js提供安全头部
- **输入验证**: 所有数据都使用Zod schemas验证
- **CORS保护**: 可配置的CORS设置

## 📁 文件传输

- **服务器上传**: 文件上传到服务器进行共享
- **智能管理**: 按房间分组存储，支持自动清理
- **保留策略**: 12小时最大保留时间，房间销毁时自动删除
- **系统通知**: 文件上传、删除操作的实时通知
- **P2P传输**: 局域网中设备间直接传输（WebRTC）
- **大小限制**: 最大文件大小100MB
- **类型支持**: 支持所有文件类型

## 🌍 环境变量

### 服务器
- `PORT` - 服务器端口（默认：3001）
- `CLIENT_URL` - 前端URL用于CORS（默认：*）
- `NODE_ENV` - 环境模式
- `LOG_LEVEL` - 日志级别（DEBUG, INFO, WARN, ERROR, SILENT）
- `LOG_COLORS` - 彩色日志输出（true/false）
- `LOG_TIMESTAMPS` - 时间戳（true/false）
- `LOG_CONTEXT` - 上下文标签（true/false）

### 客户端
- `VITE_SERVER_URL` - 后端服务器URL（默认：http://localhost:3001）

## 📋 开发命令

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 构建所有包
bun run build

# 运行类型检查
bun run type-check

# 运行代码检查
bun run lint

# 构建单个包
bun run shared:build
bun run server:build
bun run client:build
bun run desktop:build

# 启动单个服务
bun run server:dev
bun run client:dev
bun run desktop:dev

# 图标管理
bun run icons:generate         # 生成Web图标
bun run icons:sync-desktop     # 同步桌面图标
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

*[中文](#cloud-clipboard--云剪贴板) | English*

A real-time cloud clipboard application that allows you to share text and files across different devices securely using room-based authentication.

## ✨ Features

- 🔐 **Secure Room Authentication** - Enter the same room key to join and share data
- 📝 **Text Sharing** - Copy and paste text instantly across devices
- 📁 **File Sharing** - Upload and download files up to 100MB
- 🔄 **Real-time Sync** - WebSocket-based instant synchronization
- 🌐 **P2P Support** - Direct file transfer for local network connections
- 🎨 **Modern UI** - Beautiful interface built with React, Tailwind CSS, and shadcn/ui
- ⚡ **Fast & Reliable** - Built with Bun, TypeScript, and strict type checking
- 📱 **Cross-Platform** - Works on desktop, tablet, and mobile devices
- 🖥️ **Desktop Application** - Native Tauri-based desktop app with automatic clipboard monitoring
- 🔄 **Session Persistence** - Automatically rejoin rooms after browser refresh
- ⏰ **Smart Management** - 2-hour inactivity auto-logout, room auto-destruction and file cleanup
- 👤 **Username Deduplication** - Automatic handling of duplicate usernames with random suffixes
- 🗂️ **File Management** - 12-hour file retention policy with automatic cleanup
- 🔔 **System Notifications** - Clear notifications for file uploads/deletions, room destruction events
- 🐛 **Debug Logging** - Configurable frontend and backend debug logging system
- 🌍 **Multilingual** - Support for Chinese and English interfaces

## 🏗️ Architecture

This project is built as a monorepo with four main packages:

- **`shared/`** - Common types, schemas, and utilities (TypeScript + Zod)
- **`server/`** - Backend API and WebSocket server (Node.js + Express + Socket.IO)
- **`client/`** - Frontend React application (React + Vite + Tailwind CSS)
- **`desktop/`** - Desktop application (Tauri + Rust, supports Windows, macOS, Linux)

## 🛠️ Tech Stack

### Backend
- **Runtime**: Bun
- **Framework**: Express.js
- **WebSockets**: Socket.IO
- **Validation**: Zod schemas
- **Security**: Helmet, CORS
- **File Upload**: Multer

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui (Radix UI)
- **WebSocket Client**: Socket.IO Client
- **Validation**: Zod schemas

### Shared
- **Type System**: TypeScript with strict mode
- **Validation**: Zod schemas
- **Utilities**: Shared utility functions

### Desktop
- **Framework**: Tauri (Rust + WebView)
- **Frontend Integration**: React + TypeScript reuse
- **System Features**: Clipboard monitoring, system notifications, autostart
- **Cross-Platform**: Windows, macOS, Linux support

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh) installed on your system
- (Optional) [Rust](https://rustup.rs/) environment for desktop application

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

3. Build the shared package:
   ```bash
   bun run shared:build
   ```

### Development

Start both server and client in development mode:
```bash
bun run dev
```

Or start them separately:

**Server** (runs on http://localhost:3001):
```bash
bun run server:dev
```

**Client** (runs on http://localhost:3000):
```bash
bun run client:dev
```

**Desktop Application**:
```bash
bun run desktop:dev
```

### Production

Build all packages (with unified deployment):
```bash
bun run build
```

Start unified service (frontend + backend):
```bash
bun run start
```

Build desktop application:
```bash
bun run desktop:build
```

> **Note**: In production, frontend and backend run on the same port (default 3001), no separate deployment needed.

## 📖 Usage

1. **Join a Room**: Enter a room key (any string) and your name
2. **Share Text**: Type or paste text and click Send
3. **Share Files**: Click the File button to upload files (max 100MB)
4. **Copy Text**: Click the Copy button on any text message
5. **Download Files**: Click the Download button on file messages
6. **Multiple Users**: Share the same room key with others to collaborate

## 🔧 Debug Features

### Frontend Debug

Use the following commands in the browser console:

```javascript
// Enable debug mode
cloudClipboardDebug.enable()

// Set log level
cloudClipboardDebug.setLevel("debug")  // debug, info, warn, error

// Check configuration
cloudClipboardDebug.getConfig()

// Disable debug
cloudClipboardDebug.disable()
```

### Backend Logging Configuration

Configure server logging via environment variables:

```bash
export LOG_LEVEL=DEBUG     # DEBUG, INFO, WARN, ERROR, SILENT
export LOG_COLORS=false    # Disable colored output
export LOG_TIMESTAMPS=false # Disable timestamps
bun run server:dev
```

For detailed usage instructions, see: [Debug Logging Guide](./docs/调试日志使用指南.md)

## 🔒 Security Features

- **Room Isolation**: Users in different rooms cannot see each other's data
- **No Persistent Storage**: Messages are only kept in memory during the session
- **Session Persistence**: Automatically rejoin rooms after browser refresh
- **Smart Cleanup**: Automatic data cleanup when users go offline or inactive
- **Secure Headers**: Helmet.js provides security headers
- **Input Validation**: All data is validated using Zod schemas
- **CORS Protection**: Configurable CORS settings

## 📁 File Transfer

- **Server Upload**: Files are uploaded to the server for sharing
- **Smart Management**: Room-based file grouping with automatic cleanup
- **Retention Policy**: 12-hour maximum retention, auto-delete on room destruction
- **System Notifications**: Real-time notifications for file upload/delete operations
- **P2P Transfer**: Direct device-to-device transfer for local network (WebRTC)
- **Size Limit**: Maximum file size of 100MB
- **Type Support**: All file types are supported

## 🌍 Environment Variables

### Server
- `PORT` - Server port (default: 3001)
- `CLIENT_URL` - Frontend URL for CORS (default: *)
- `NODE_ENV` - Environment mode
- `LOG_LEVEL` - Log level (DEBUG, INFO, WARN, ERROR, SILENT)
- `LOG_COLORS` - Colored log output (true/false)
- `LOG_TIMESTAMPS` - Timestamps (true/false)
- `LOG_CONTEXT` - Context labels (true/false)

### Client
- `VITE_SERVER_URL` - Backend server URL (default: http://localhost:3001)

## 📋 Development Commands

```bash
# Install dependencies
bun install

# Start development servers
bun run dev

# Build all packages
bun run build

# Run type checking
bun run type-check

# Run linting
bun run lint

# Build individual packages
bun run shared:build
bun run server:build
bun run client:build
bun run desktop:build

# Start individual services
bun run server:dev
bun run client:dev
bun run desktop:dev

# Icon management
bun run icons:generate         # Generate web icons
bun run icons:sync-desktop     # Sync desktop icons
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).