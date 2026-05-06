# 置顶房间消息持久化设计

## 概述

为置顶房间添加 SQLite 持久化存储，使服务重启后能恢复置顶房间的完整状态（消息、房间设置）。

## 需求

- 仅置顶房间的消息需要持久化，非置顶房间保持纯内存行为
- 存储方式：SQLite（rusqlite bundled 模式）
- 恢复时机：服务启动时自动加载
- 文件消息：仅持久化元信息，恢复时验证文件存在性

## 架构

新增 `PersistenceService` 层，与 `RoomService` 协作：

```
RoomService
  ├── rooms (RwLock<HashMap<String, Room>>)  ← 内存存储（不变）
  └── persistence: Arc<dyn PersistenceServiceTrait>
        └── SqlitePersistenceService
              └── data/pinned_rooms.db  ← SQLite 文件
```

核心原则：内存仍然是主要数据源，SQLite 是置顶房间的持久化备份。读取只在启动时。

## 写入策略：Channel 解耦

RoomService 的方法是同步的，而 SQLite 写入是阻塞操作。为避免持锁期间做 DB 写入阻塞所有房间操作，采用 **mpsc channel + 专用 writer task** 方案：

```
RoomService (同步方法)
  │
  ├─ 1. 内存写入（持锁期间）
  ├─ 2. 释放锁
  └─ 3. persistence_tx.try_send(PersistenceCommand::AppendMessage { ... })
                                      │
                                      ▼
                            PersistenceWriter (tokio task)
                              │
                              └─ tokio::task::spawn_blocking(|| { sqlite.write(...) })
```

**Channel 配置**：使用 `tokio::sync::mpsc::channel(1024)` 有界 channel，配合 `try_send` 非阻塞发送。channel 满时记录 warn 日志并丢弃命令——与"内存为主"原则一致，DB 延迟写入不应阻塞业务。下次 `save_pinned_room`（全量覆盖）会自动修复不一致。

**PersistenceCommand 枚举**：

```rust
enum PersistenceCommand {
    SavePinnedRoom { room_key: String, data: PersistedRoomData },
    AppendMessage { room_key: String, message: Message },
    DeleteMessage { message_id: String },
    RemovePinnedRoom { room_key: String },
    UpdateRoomPassword { room_key: String, password_hash: Option<String>, password: Option<String> },
    Shutdown,
}
```

**写入失败策略**：内存为主、DB 为备份。写入失败仅记录 `warn!` 日志，不回滚内存操作，不阻塞业务。这与"内存为主"的核心原则一致——DB 不一致在下次 save_pinned_room 时会自动修复（全量覆盖）。

**Message clone 开销**：AppendMessage 命令包含完整 Message 结构体，通过 channel 传递需要 clone。这是 channel 解耦的必要代价，对于正常消息频率可接受。

## Writer Task 生命周期

```
main.rs
  │
  ├─ persistence.initialize()     ← 建表/迁移
  ├─ persistence.load_pinned_rooms()
  ├─ persistence.start_writer()   ← spawn writer task
  ├─ RoomService::new(persistence)
  ├─ Socket.IO + HTTP server 启动
  │
  └─ shutdown_signal handler
       └─ persistence.shutdown()  ← 发送 Shutdown 命令，等待 writer task 完成
```

- **spawn 时机**：`main.rs` 中 `persistence.initialize()` 之后、`RoomService::new()` 之前
- **shutdown 时机**：进程收到 SIGTERM/SIGINT 时，在 shutdown_signal handler 中调用 `persistence.shutdown()`
- **进程崩溃**：channel 中未消费的命令会丢失。可接受——与"内存为主"原则一致，重启后从 DB 加载的是最后成功写入的状态
- **shutdown 实现**：发送 `Shutdown` 命令到 channel，writer task 收到后 flush 并退出，`shutdown()` 等待 task JoinHandle 完成

## 数据库 Schema

```sql
-- Schema 版本管理
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY
);
INSERT INTO schema_version VALUES (1);

-- 置顶房间信息
CREATE TABLE pinned_rooms (
    room_key TEXT PRIMARY KEY,
    password_hash TEXT,
    password TEXT,           -- 明文密码，用于分享链接生成
    created_at TEXT NOT NULL,
    created_by TEXT,
    last_activity TEXT NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    message_dropped_count INTEGER NOT NULL DEFAULT 0
);

-- 消息表（sender 和 file_info 以 JSON 存储，保证结构完整性）
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    room_key TEXT NOT NULL,
    sender_json TEXT NOT NULL,     -- MessageSender 完整 JSON
    message_type TEXT NOT NULL,    -- 'text', 'file', 'system'
    content TEXT,
    timestamp TEXT NOT NULL,
    file_info_json TEXT,           -- FileInfo 完整 JSON（文件消息）
    file_id TEXT,                  -- 仅存 file_id，不存 download_url
    FOREIGN KEY (room_key) REFERENCES pinned_rooms(room_key) ON DELETE CASCADE
);

CREATE INDEX idx_messages_room_key ON messages(room_key);
CREATE INDEX idx_messages_timestamp ON messages(room_key, timestamp);
```

**设计决策**：

- `sender_json`：将 `MessageSender` 以 JSON 整体存储，包含 `id`、`name`、`is_online`、`last_seen`、`device_type`、`fingerprint` 全部字段。恢复时 `is_online` 设为 false、`last_seen` 使用存储值。
- `file_info_json`：将 `FileInfo` 以 JSON 整体存储，包含 `name`、`size`、`file_type`、`last_modified` 全部字段。
- `file_id`：仅存储 file_id，不存储 `download_url`。恢复时根据当前 `PUBLIC_URL` 重新生成 download_url，避免 URL 因环境变更而过期。
- `password`：存储明文密码以支持分享链接功能。这是功能与安全的权衡——DB 文件本身应通过文件权限保护。
- **撤回 = 物理删除**：消息撤回时从 DB 中 DELETE 对应行，恢复后撤回的消息不会出现。

## save_pinned_room 全量覆盖实现

`save_pinned_room` 采用 **DELETE + INSERT** 策略：

```sql
DELETE FROM messages WHERE room_key = ?;
DELETE FROM pinned_rooms WHERE room_key = ?;
INSERT INTO pinned_rooms (...) VALUES (...);
INSERT INTO messages (...) VALUES (...);  -- 批量
```

在同一个 SQLite 事务中执行，避免与 AppendMessage 的主键冲突。即使 AppendMessage 先插入了某条消息，SavePinnedRoom 的 DELETE 会先清除，再重新插入。

## PersistedRoom 与 PersistenceServiceTrait

```rust
/// 持久化房间数据（包含重建 Room 对象所需的全部字段）
pub struct PersistedRoom {
    pub room_key: String,
    pub password_hash: Option<String>,
    pub password: Option<String>,
    pub created_at: DateTime<Utc>,
    pub created_by: Option<String>,
    pub last_activity: DateTime<Utc>,
    pub is_pinned: bool,
    pub message_count: u64,
    pub message_dropped_count: u64,
}

#[async_trait]
pub trait PersistenceServiceTrait: Send + Sync {
    /// 初始化数据库（建表、检查 schema 版本、执行迁移）。
    /// 同时创建 data/ 父目录（如不存在）。
    async fn initialize(&self) -> Result<(), PersistenceError>;

    /// 保存置顶房间完整状态（全量覆盖：DELETE + INSERT 事务）。
    /// 注意：返回 Ok 仅表示命令已入队，不保证 DB 写入成功。
    async fn save_pinned_room(&self, room: &Room) -> Result<(), PersistenceError>;

    /// 追加单条消息。
    /// 注意：返回 Ok 仅表示命令已入队，不保证 DB 写入成功。
    async fn append_message(&self, room_key: &str, message: &Message) -> Result<(), PersistenceError>;

    /// 删除消息（撤回，物理删除）。
    /// 注意：返回 Ok 仅表示命令已入队，不保证 DB 写入成功。
    async fn delete_message(&self, message_id: &str) -> Result<(), PersistenceError>;

    /// 加载所有置顶房间（启动时，同步读取，不走 channel）。
    async fn load_pinned_rooms(&self) -> Result<Vec<(PersistedRoom, Vec<Message>)>, PersistenceError>;

    /// 取消置顶时删除持久化数据。
    /// 注意：返回 Ok 仅表示命令已入队，不保证 DB 写入成功。
    async fn remove_pinned_room(&self, room_key: &str) -> Result<(), PersistenceError>;

    /// 更新房间密码。
    /// 注意：返回 Ok 仅表示命令已入队，不保证 DB 写入成功。
    async fn update_room_password(
        &self,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError>;

    /// 启动 writer task（在 main.rs 中调用）。
    async fn start_writer(&self);

    /// 关闭持久化服务（发送 Shutdown 命令，等待 writer task 完成）。
    async fn shutdown(&self) -> Result<(), PersistenceError>;
}

/// NoOp 实现（PERSISTENCE_ENABLED=false 时使用）
pub struct NoOpPersistenceService;

#[async_trait]
impl PersistenceServiceTrait for NoOpPersistenceService {
    // 所有方法返回 Ok(())，start_writer/shutdown 为空操作
}
```

**fire-and-forget 语义**：除 `initialize()`、`load_pinned_rooms()` 和 `shutdown()` 外，所有写入方法返回 `Ok(())` 仅表示命令已成功入队，不保证 DB 写入成功。这是 channel 解耦的固有特性，与"内存为主"原则一致。

## 数据流

### 写入路径（实时，异步解耦）

1. 用户发消息 → `RoomService.add_message()` → 内存写入（持锁）
2. 释放锁后，检查房间是否置顶 → 是则 `persistence_tx.try_send(AppendMessage)`
3. PersistenceWriter task 收到命令 → `spawn_blocking` 执行 SQLite 写入
4. 写入失败仅记录 warn 日志，不影响业务

### 置顶/取消置顶路径

1. 置顶 → `RoomService.pin_room()` → 内存更新 → `persistence_tx.try_send(SavePinnedRoom)`（全量保存房间+消息）
2. 取消置顶 → `RoomService.unpin_room()` → 内存更新 → `persistence_tx.try_send(RemovePinnedRoom)`

### 密码修改路径

1. `set_room_password()` → 内存更新 → 检查是否置顶 → 是则 `persistence_tx.try_send(UpdateRoomPassword)`

### 撤回路径

1. 用户撤回消息 → `RoomService.remove_message()` → 内存删除
2. 检查房间是否置顶 → 是则 `persistence_tx.try_send(DeleteMessage)`

### 读取路径（启动时，在 Socket.IO 初始化前）

1. 服务启动 → `persistence.initialize()` → 建表/迁移/创建目录
2. `persistence.load_pinned_rooms()` → 读取所有置顶房间（同步读取，不走 channel）
3. 对每个房间：
   - 从 `PersistedRoom` 重建 `Room` 对象（users HashMap 为空，所有用户需重新 join）
   - 加载消息，只取最近 `max_messages` 条（丢弃更老的，与内存溢出策略一致）
   - 验证文件消息存在性，重新生成 download_url
   - 加入 rooms HashMap
4. `persistence.start_writer()` → spawn writer task
5. 创建 RoomService
6. Socket.IO 初始化，开始接受连接

### 房间销毁路径

1. 置顶房间被销毁（手动操作或未来逻辑变更）→ `persistence_tx.try_send(RemovePinnedRoom)` 清理 DB

## 消息溢出与恢复策略

- **运行时**：内存中最多保留 `max_messages`（默认 1000）条，溢出时丢弃最老的 20%
- **SQLite 中**：保留全部消息（不主动删除溢出消息），作为完整历史归档
- **恢复时**：只加载最近 `max_messages` 条消息到内存，更老的消息保留在 DB 中
- **`message_count` / `message_dropped_count`**：从 `pinned_rooms` 表恢复，保持计数器连续性

## 文件消息恢复

启动加载时，对文件类型消息：

- 检查 `file_id` 对应的文件是否存在于 uploads/ 目录
- 不存在则标记消息为 `System` 类型，内容改为 "文件已失效"
- `download_url` 直接拼接字符串 `format!("{}/api/files/download/{}", public_url, file_id)` 重新生成，不依赖 file_manager
- 返回失效消息 ID 列表供日志记录

## 恢复后状态说明

- **Room.users**：恢复后为空 HashMap，所有用户需重新 join
- **sender.is_online**：所有消息的发送者 `is_online` 设为 false
- **sender.last_seen**：使用持久化时的值
- **download_url**：根据当前 `PUBLIC_URL` 重新生成

## 启动时序

```rust
// main.rs 启动流程
async fn main() {
    // 1. 初始化持久化服务（建表/迁移/创建目录）
    let persistence = Arc::new(SqlitePersistenceService::new(&db_path));
    persistence.initialize().await?;

    // 2. 加载置顶房间到内存（同步读取，不走 channel）
    let pinned_rooms = persistence.load_pinned_rooms().await?;

    // 3. 启动 writer task
    persistence.start_writer().await;

    // 4. 创建 RoomService（预填充置顶房间）
    let room_service = Arc::new(RoomService::with_pinned_rooms(pinned_rooms, persistence.clone()));

    // 5. 初始化 Socket.IO、路由等（此后才开始接受连接）
    let app = create_app(room_service, ...);
    let listener = TcpListener::bind(&addr).await;

    // 6. graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(persistence.clone()))
        .await?;
}

async fn shutdown_signal(persistence: Arc<dyn PersistenceServiceTrait>) {
    tokio::signal::ctrl_c().await.ok();
    persistence.shutdown().await.ok();
}
```

## 配置项

| 环境变量              | 默认值                 | 说明                                     |
| --------------------- | ---------------------- | ---------------------------------------- |
| `PERSISTENCE_DB_PATH` | `data/pinned_rooms.db` | SQLite 数据库路径                        |
| `PERSISTENCE_ENABLED` | `true`                 | 是否启用持久化（false 时使用 NoOp 实现） |

## 依赖变更

`server-rust/Cargo.toml` 新增：

- `rusqlite = { version = "0.31", features = ["bundled"] }`
- `serde_json` （如尚未添加，用于 sender/file_info JSON 序列化）

**MSRV 兼容性**：rusqlite 0.31 要求 MSRV 1.77+，项目 MSRV 1.87 满足要求。bundled 模式在 Docker 中通过 `build-base` 包提供 C 编译器，无需 cmake。

## Docker 构建调整

当前 Dockerfile 基于 `rust:1.93-alpine`，安装了 `musl-dev pkgconfig openssl-dev openssl-libs-static`。

rusqlite bundled 模式需要 C 编译器编译 SQLite C 库。Alpine 的 `musl-dev` 不包含 gcc，需要额外安装 `build-base`：

```dockerfile
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static build-base
```

## Docker 数据持久化

SQLite 数据库文件位于 `data/pinned_rooms.db`，容器重启会丢失。需要：

1. Dockerfile 中创建目录：`RUN mkdir -p /app/data`
2. 运行时挂载 volume：`-v ./data:/app/data`
3. 文档中说明 volume 挂载方式

## Schema 版本管理

`schema_version` 表记录当前版本。`initialize()` 中：

- 检查版本号，与代码期望版本一致则跳过
- 版本低于期望则执行迁移脚本（逐版本升级）
- 版本高于期望则报错（防止新版数据被旧代码破坏）
- 自动创建 `PERSISTENCE_DB_PATH` 的父目录（`std::fs::create_dir_all`）

## 测试策略

- 单元测试：`SqlitePersistenceService` 实现（使用内存数据库 `:memory:`）
  - 保存/加载房间完整性
  - 消息追加/删除
  - Schema 初始化和版本管理
  - NoOp 实现验证
  - channel 满时 try_send 失败处理
  - save_pinned_room 全量覆盖（DELETE + INSERT 事务）
- 集成测试：置顶 → 发消息 → 模拟重启（新建 RoomService + load）→ 验证消息恢复
- 并发测试：多线程通过 channel 同时发送不同房间的持久化命令
- 文件恢复测试：文件存在/不存在两种场景
