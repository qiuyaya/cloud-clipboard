# 研究发现

## TypeScript 后端 API 分析

### HTTP API 完整列表

#### 房间管理 `/api/rooms`
- `POST /create` - 创建房间
- `GET /info` - 获取房间信息 (需要 x-room-key header)
- `GET /users` - 获取用户列表 (需要 x-room-key header)
- `GET /messages?limit=N` - 获取消息历史 (需要 x-room-key header)
- `GET /stats` - 系统统计
- `POST /validate-user` - 验证用户
- `GET /:roomKey` - 通过路径获取房间

#### 文件管理 `/api/files`
- `POST /upload` - 上传文件 (multipart, 需要 x-room-key)
- `GET /download/:fileId` - 下载文件
- `DELETE /:fileId` - 删除文件 (需要 x-room-key)

#### 分享管理 `/api/share`
- `POST /` - 创建分享
- `GET /` - 获取用户分享列表
- `GET /:shareId` - 获取分享详情
- `DELETE /:shareId` - 撤销分享
- `POST /:shareId/permanent-delete` - 永久删除
- `GET /:shareId/access` - 访问日志

#### 公开下载
- `GET /public/file/:shareId` - 下载分享文件

### Socket.IO 事件

#### 客户端 → 服务端
- `joinRoom` - 加入房间
- `joinRoomWithPassword` - 密码加入
- `leaveRoom` - 离开房间
- `sendMessage` - 发送消息
- `requestUserList` - 请求用户列表
- `setRoomPassword` - 设置密码
- `shareRoomLink` - 生成分享链接
- `p2pOffer/Answer/IceCandidate` - WebRTC P2P

#### 服务端 → 客户端
- `message` - 新消息
- `userJoined` - 用户加入
- `userLeft` - 用户离开
- `userList` - 用户列表
- `error` - 错误
- `systemMessage` - 系统消息
- `roomDestroyed` - 房间销毁
- `roomPasswordSet` - 密码设置
- `roomLinkGenerated` - 链接生成
- `passwordRequired` - 需要密码
- `p2pOffer/Answer/IceCandidate` - WebRTC P2P

## 关键数据结构

### User
```rust
struct User {
    id: String,
    name: String,
    is_online: bool,
    last_seen: DateTime<Utc>,
    device_type: String,  // "mobile" | "desktop" | "tablet" | "unknown"
    fingerprint: Option<String>,
}
```

### Message
```rust
struct Message {
    id: String,
    msg_type: String,  // "text" | "file"
    content: Option<String>,
    sender: User,
    timestamp: DateTime<Utc>,
    room_key: String,
    file_info: Option<FileInfo>,
    download_url: Option<String>,
}
```

### 认证机制
- HTTP: 使用 `x-room-key` header
- Socket.IO: 通过 `joinRoom` 事件验证

## 速率限制配置
- 文件上传: 自定义限流
- 分享创建: 10次/分钟
- 公开下载: 100次/分钟/IP
- Socket 事件各有不同限制
