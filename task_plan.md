# Rust 后端完整实现计划

## 目标
将 Cloud Clipboard 后端从 TypeScript 完全迁移到 Rust，实现 100% API 兼容。

## 当前状态
- [x] 基础框架搭建完成
- [x] 核心服务层 (RoomService, FileManager, ShareService)
- [x] 基础 Socket.IO 连接和 joinRoom 事件
- [x] 完整 HTTP API 兼容
- [x] 完整 Socket.IO 事件兼容
- [x] 认证中间件 (x-room-key header)
- [x] 安全头中间件 (helmet 等效)

---

## Phase 1: HTTP API - 房间管理 (`/api/rooms`)
**Status:** `completed` ✅

### 需要实现的端点
| 端点 | 状态 |
|------|------|
| POST `/api/rooms/create` | ✅ |
| GET `/api/rooms/info` (需要 x-room-key header) | ✅ |
| GET `/api/rooms/users` (需要 x-room-key header) | ✅ |
| GET `/api/rooms/messages?limit=N` (需要 x-room-key header) | ✅ |
| GET `/api/rooms/stats` | ✅ |
| POST `/api/rooms/validate-user` | ✅ |
| GET `/api/rooms/:roomKey` | ✅ |
| GET `/api/rooms/:roomKey/exists` | ✅ |
| POST `/api/rooms/:roomKey/verify-password` | ✅ |

---

## Phase 2: HTTP API - 文件管理 (`/api/files`)
**Status:** `completed` ✅

### 需要实现的端点
| 端点 | 状态 |
|------|------|
| POST `/api/files/upload` | ✅ |
| GET `/api/files/download/:fileId` | ✅ |
| DELETE `/api/files/:fileId` | ✅ |

### 已实现的安全功能
- ✅ 危险扩展名过滤 (.exe, .sh, .php 等)
- ✅ 路径遍历保护
- ✅ 文件所属房间关联
- ✅ x-room-key header 认证

---

## Phase 3: HTTP API - 分享管理 (`/api/share`)
**Status:** `completed` ✅

### 需要实现的端点
| 端点 | 状态 |
|------|------|
| POST `/api/share` | ✅ |
| GET `/api/share` (用户分享列表) | ✅ |
| GET `/api/share/:shareId` | ✅ |
| DELETE `/api/share/:shareId` | ✅ |
| POST `/api/share/:shareId/permanent-delete` | ✅ |
| GET `/api/share/:shareId/access` | ✅ |
| GET `/public/file/:shareId` | ✅ |

---

## Phase 4: Socket.IO 事件 - 完整实现
**Status:** `completed` ✅

### 客户端 → 服务端
| 事件 | 状态 |
|------|------|
| `joinRoom` | ✅ |
| `joinRoomWithPassword` | ✅ |
| `leaveRoom` | ✅ |
| `sendMessage` | ✅ |
| `requestUserList` | ✅ |
| `setRoomPassword` | ✅ |
| `shareRoomLink` | ✅ |
| `p2pOffer` | ✅ |
| `p2pAnswer` | ✅ |
| `p2pIceCandidate` | ✅ |

### 服务端 → 客户端
| 事件 | 状态 |
|------|------|
| `message` | ✅ |
| `userJoined` | ✅ |
| `userLeft` | ✅ |
| `userList` | ✅ |
| `error` | ✅ |
| `roomPasswordSet` | ✅ |
| `roomLinkGenerated` | ✅ |
| `passwordRequired` | ✅ |
| `p2pOffer/Answer/Ice` | ✅ |

---

## Phase 5: 中间件和安全
**Status:** `completed` ✅

1. [x] Header 认证中间件 (`x-room-key`) - 已在各路由中实现
2. [x] CORS 配置完善
3. [x] 安全头 (helmet 等效):
   - x-content-type-options: nosniff
   - x-frame-options: DENY
   - x-xss-protection: 1; mode=block
   - referrer-policy: strict-origin-when-cross-origin

---

## Phase 6: 测试和验证
**Status:** `completed` ✅

1. [x] 健康检查端点测试
2. [x] 房间管理 API 全部测试通过
3. [x] 文件上传/下载/删除测试通过
4. [x] 分享创建/列表/下载测试通过
5. [x] 安全头验证通过
6. [x] 与前端基础联调通过 (用户可成功加入房间)

---

## 技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Web 框架 | Axum 0.8 | 现代、高性能、类型安全 |
| Socket.IO | socketioxide 0.15 | Rust 原生实现 |
| 异步运行时 | Tokio | 生态成熟 |
| 序列化 | Serde | 标准选择 |
| 密码哈希 | bcrypt | 安全性 |

---

## 错误记录

| 错误 | 尝试 | 解决方案 |
|------|------|----------|
| 客户端卡在"加入中" | 1 | 修改 Socket 事件格式匹配 TS 版本 |
| 404 /api/rooms/messages | - | 需要实现该端点 |

---

## 文件清单

| 文件 | 用途 | 状态 |
|------|------|------|
| `src/main.rs` | 入口点 | ✅ |
| `src/models/` | 数据模型 | ✅ |
| `src/services/room_service.rs` | 房间管理 | ✅ |
| `src/services/file_manager.rs` | 文件管理 | ✅ |
| `src/services/share_service.rs` | 分享管理 | ✅ |
| `src/services/socket.rs` | WebSocket | ✅ |
| `src/routes/rooms.rs` | 房间 API | ✅ |
| `src/routes/files.rs` | 文件 API | ✅ |
| `src/routes/share.rs` | 分享 API | ✅ |
| `src/middleware/rate_limit.rs` | 限流 | ✅ (待集成)
