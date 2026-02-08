# Cloud Clipboard Server - Rust Implementation

这是 Cloud Clipboard 后端服务的 Rust 重构版本。

## 前置要求

1. **Rust 工具链** (已安装)

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **C 编译器** (用于编译依赖)

   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential

   # macOS
   xcode-select --install

   # Fedora
   sudo dnf install gcc
   ```

## 项目结构

```
server-rust/
├── Cargo.toml           # 项目配置和依赖
├── src/
│   ├── main.rs          # 入口点
│   ├── models/          # 数据模型
│   │   ├── mod.rs
│   │   ├── user.rs      # 用户模型
│   │   ├── room.rs      # 房间模型
│   │   ├── message.rs   # 消息模型
│   │   └── share.rs     # 分享模型
│   ├── services/        # 业务逻辑
│   │   ├── mod.rs
│   │   ├── room_service.rs    # 房间管理
│   │   ├── file_manager.rs    # 文件管理
│   │   ├── share_service.rs   # 分享管理
│   │   └── socket.rs          # Socket.IO 处理
│   ├── routes/          # HTTP 路由
│   │   ├── mod.rs
│   │   ├── health.rs    # 健康检查
│   │   ├── api_info.rs  # API 信息
│   │   ├── rooms.rs     # 房间 API
│   │   ├── files.rs     # 文件 API
│   │   └── share.rs     # 分享 API
│   ├── middleware/      # 中间件
│   │   ├── mod.rs
│   │   └── rate_limit.rs
│   └── utils/           # 工具函数
│       ├── mod.rs
│       └── id_generator.rs
└── README.md
```

## 构建和运行

### 开发模式

```bash
cargo run
```

### 发布构建

```bash
cargo build --release
./target/release/cloud-clipboard-server
```

### 检查代码

```bash
cargo check
cargo clippy
```

### 运行测试

```bash
cargo test
```

## 环境变量

| 变量                   | 默认值            | 说明         |
| ---------------------- | ----------------- | ------------ |
| `PORT`                 | 3001              | 服务器端口   |
| `NODE_ENV`             | development       | 环境模式     |
| `UPLOAD_DIR`           | ./uploads         | 文件上传目录 |
| `MAX_FILE_SIZE`        | 104857600 (100MB) | 最大文件大小 |
| `FILE_RETENTION_HOURS` | 12                | 文件保留时间 |
| `RUST_LOG`             | info              | 日志级别     |

## 技术栈

- **Web 框架**: Axum 0.8
- **异步运行时**: Tokio
- **Socket.IO**: socketioxide
- **序列化**: Serde
- **日志**: tracing
- **限流**: governor

## API 端点

与 TypeScript 版本兼容的 API:

- `GET /api` - API 信息
- `GET /api/health` - 健康检查
- `POST /api/rooms` - 创建房间
- `GET /api/rooms/{room_key}` - 获取房间信息
- `GET /api/rooms/{room_key}/exists` - 检查房间是否存在
- `POST /api/rooms/{room_key}/verify-password` - 验证房间密码
- `POST /api/files/upload` - 上传文件
- `GET /api/files/download/{filename}` - 下载文件
- `POST /api/share` - 创建分享
- `GET /api/share/{share_id}` - 获取分享信息
- `DELETE /api/share/{share_id}` - 删除分享
- `GET /api/share/{share_id}/logs` - 获取访问日志
- `GET /api/share/user/{user_id}` - 获取用户分享列表
- `GET /public/file/{share_id}` - 公开文件下载

## Socket.IO 事件

### 客户端 -> 服务器

- `joinRoom` - 加入房间
- `sendMessage` - 发送消息
- `leaveRoom` - 离开房间

### 服务器 -> 客户端

- `joinedRoom` - 加入房间结果
- `userJoined` - 用户加入通知
- `userLeft` - 用户离开通知
- `userOffline` - 用户离线通知
- `newMessage` - 新消息

## 与 TypeScript 版本的对比

| 特性     | TypeScript | Rust    |
| -------- | ---------- | ------- |
| 内存占用 | ~50-100MB  | ~5-15MB |
| 启动时间 | ~2s        | ~0.1s   |
| 并发处理 | 事件循环   | 多线程  |
| 类型安全 | 编译时     | 编译时  |
