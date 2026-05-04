# 后端关键模块测试覆盖率提升至 80% — 设计文档

**日期**: 2026-05-04
**目标**: 将 7 个核心业务模块的测试覆盖率提升至 80%+
**策略**: 方案 B — 重构 + 单元测试，追求长期稳定性

## 1. 现状分析

### 当前覆盖率

| 模块                       | 覆盖率 | 可执行行 | 代码行数 |
| -------------------------- | ------ | -------- | -------- |
| `services/socket.rs`       | 0.0%   | 501      | 1634     |
| `routes/share.rs`          | 0.0%   | 322      | 1259     |
| `routes/rooms.rs`          | 0.0%   | 142      | 649      |
| `routes/files.rs`          | 10.5%  | 171      | 807      |
| `middleware/rate_limit.rs` | 0.0%   | 94       | 519      |
| `error.rs`                 | 4.0%   | 25       | 157      |
| `models/message.rs`        | 65.2%  | 23       | 271      |

**排除模块说明**: `routes/health.rs`（0%，22 可执行行）和 `routes/api_info.rs`（0%，11 可执行行）代码量极小，逻辑简单，不在本次核心目标范围内。`main.rs`（0%，199 可执行行）是启动入口，难测且价值低，排除。

### 核心问题

所有 routes 和 socket 模块的 async handler 函数完全没有被测试覆盖。现有测试（包括 `tests/` 目录下的集成测试文件）都只测试了纯函数、序列化、Mock 模型逻辑，从未实际调用 axum handler 或 socket handler。

`tests/` 目录下的测试文件（如 `socket_service_tests.rs`、`rooms_routes_tests.rs`）使用自定义 Mock 结构体重新实现了业务逻辑来测试，与源文件无任何 import 关系，对实际代码的覆盖率为 0%。

## 2. 设计方案

### 2.1 总体策略：分层重构

```
┌─────────────────────────────────────────────────────┐
│  Handler 层（薄壳）                                   │
│  - 只负责参数提取和 I/O 编排                           │
│  - 通过集成测试覆盖                                    │
├─────────────────────────────────────────────────────┤
│  业务逻辑层（纯函数/trait 方法）                        │
│  - 所有决策逻辑                                       │
│  - 通过单元测试覆盖（mock trait 实现）                  │
├─────────────────────────────────────────────────────┤
│  服务层（RoomService / ShareService / FileManager）   │
│  - 通过 trait 抽象，mock 替换                          │
│  - 已有较好覆盖率，补充边界测试                          │
└─────────────────────────────────────────────────────┘
```

### 2.2 服务层 Trait 抽象

为三个服务定义 trait，使 handler 可通过 mock 进行单元测试。

#### 2.2.1 JoinRoomRequest 改造为 owning 版本

**前提条件**: 当前 `JoinRoomRequest<'a>` 包含生命周期参数，无法在 trait object 中使用。必须先将其改为 owning 版本。

```rust
// 改造前（带生命周期）:
pub struct JoinRoomRequest<'a> {
    pub room_key: &'a str,
    pub user_id: &'a str,
    pub username: &'a str,
    pub socket_id: &'a str,
    pub password: Option<&'a str>,
    pub device_type: &'a str,
    pub fingerprint: Option<&'a str>,
}

// 改造后（owning）:
pub struct JoinRoomRequest {
    pub room_key: String,
    pub user_id: String,
    pub username: String,
    pub socket_id: String,
    pub password: Option<String>,
    pub device_type: String,
    pub fingerprint: Option<String>,
}
```

**影响范围**: `room_service.rs` 中的 `join_room` 方法、`socket.rs` 中构造 `JoinRoomRequest` 的代码、所有使用 `JoinRoomRequest` 的测试文件。builder 方法模式保持不变（`with_password`、`with_fingerprint`、`with_device_type`），只是参数类型从 `&'a str` 改为 `impl Into<String>`。

#### 2.2.2 RoomServiceTrait

```rust
pub trait RoomServiceTrait: Send + Sync {
    fn create_room(&self, room_key: &str, password: Option<&str>, creator_fingerprint: Option<&str>) -> Result<RoomInfo, String>;
    fn get_room_info(&self, room_key: &str) -> Option<RoomInfo>;
    fn room_exists(&self, room_key: &str) -> bool;
    fn room_has_password(&self, room_key: &str) -> bool;
    fn get_room_password(&self, room_key: &str) -> Option<String>;
    fn verify_room_password(&self, room_key: &str, password: &str) -> Result<bool, String>;
    fn join_room(&self, req: JoinRoomRequest) -> Result<(User, Vec<User>), String>;
    fn get_room_users(&self, room_key: &str) -> Vec<User>;
    fn get_messages(&self, room_key: &str) -> Vec<Message>;
    fn find_user_by_fingerprint(&self, room_key: &str, fingerprint_hash: &str) -> Option<User>;
    fn get_room_stats(&self) -> RoomStats;
    fn add_message(&self, room_key: &str, message: Message) -> Result<(), String>;
    fn remove_message(&self, room_key: &str, message_id: &str) -> Result<bool, String>;
    fn get_message_sender(&self, room_key: &str, message_id: &str) -> Option<String>;
    fn get_user_by_socket(&self, socket_id: &str) -> Option<User>;
    fn get_socket_by_user(&self, user_id: &str) -> Option<String>;
    fn set_room_password(&self, room_key: &str, password: Option<&str>) -> Result<bool, String>;
    fn pin_room(&self, room_key: &str, fingerprint: &str) -> Result<bool, String>;
    fn unpin_room(&self, room_key: &str, fingerprint: &str) -> Result<bool, String>;
    fn is_room_pinned(&self, room_key: &str) -> bool;
    fn update_user_status(&self, room_key: &str, user_id: &str, is_online: bool);
    fn leave_room(&self, socket_id: &str) -> Option<(String, User)>;
    fn set_user_offline(&self, socket_id: &str) -> Option<(String, User)>;
    fn subscribe(&self) -> broadcast::Receiver<RoomEvent>;
    fn cleanup_inactive_rooms(&self) -> Vec<String>;
}
```

**`schedule_room_destroy_check` 处理**: 此方法签名 `self: &Arc<Self>` 无法放入 trait。解决方案：**不放入 trait**。原因：

1. 该方法只是调度一个定时任务触发器，核心清理逻辑在 `cleanup_inactive_rooms` 中（已包含在 trait 中）
2. 在 socket handler 中调用时，`room_service` 是 `Arc<RoomService>` 具体类型，可以直接调用
3. 测试中可通过 `Arc<RoomService>` 直接测试此方法，无需通过 trait

**`Arc<RoomService>` 与 `Arc<dyn RoomServiceTrait>` 共存方案**: `setup_socket_handlers` 独立接收 `Arc<RoomService>` 参数（保持现有签名），而非从 AppState 中提取。AppState 中的 `Arc<dyn RoomServiceTrait>` 用于 HTTP handler，socket handler 使用独立传入的 `Arc<RoomService>`。两者指向同一个 `RoomService` 实例（在 `main.rs` 中先创建 `Arc<RoomService>`，再将其同时转为 trait object 注入 AppState 和直接传给 socket）。

#### 2.2.3 FileManagerTrait

```rust
#[async_trait]
pub trait FileManagerTrait: Send + Sync {
    async fn save_file(&self, room_key: &str, original_name: &str, mime_type: &str, data: &[u8]) -> anyhow::Result<FileInfo>;
    fn get_file(&self, filename: &str) -> Option<FileInfo>;
    fn get_file_path(&self, filename: &str) -> Option<PathBuf>;
    async fn delete_file(&self, filename: &str) -> anyhow::Result<Option<FileInfo>>;
    fn delete_room_files(&self, room_key: &str) -> Vec<FileInfo>;
    async fn cleanup_expired_files(&self) -> Vec<FileInfo>;
    async fn cleanup_orphaned_files(&self) -> usize;
    fn get_stats(&self) -> FileStats;
    fn get_storage_usage(&self) -> StorageUsage;
    fn upload_dir(&self) -> PathBuf;
    fn max_file_size(&self) -> u64;
    fn get_retention_hours(&self) -> i64;
}
```

**注意**:

- `upload_dir()` 返回类型从 `&Path` 改为 `PathBuf`，以兼容 trait object。性能影响可忽略（每次调用一次 clone）
- `get_upload_dir_path()` 与 `upload_dir()` 功能重复，trait 中统一为 `upload_dir() -> PathBuf`；具体类型 `FileManager` 上保留 `get_upload_dir_path()` 作为 `upload_dir().as_path()` 的便捷别名
- `cleanup_expired_files` 和 `cleanup_orphaned_files` 保留在 trait 中，因为 `main.rs` 事件监听器使用

#### 2.2.4 ShareServiceTrait

```rust
pub trait ShareServiceTrait: Send + Sync {
    fn create_share(&self, req: CreateShareRequest) -> Result<(ShareInfo, Option<String>), String>;
    fn get_share(&self, share_id: &str) -> Option<ShareInfo>;
    fn get_share_info(&self, share_id: &str) -> Option<ShareInfoResponse>;
    fn get_user_shares(&self, user_id: &str) -> Vec<ShareInfo>;
    fn get_user_shares_response(&self, user_id: &str) -> Vec<ShareInfoResponse>;
    fn verify_password(&self, share_id: &str, password: &str) -> Result<bool, String>;
    fn record_access(&self, share_id: &str, ip_address: String, success: bool, bytes: Option<u64>, error: Option<String>, user_agent: Option<String>) -> Result<(), String>;
    fn get_access_logs(&self, share_id: &str) -> Vec<ShareAccessLog>;
    fn revoke_share(&self, share_id: &str) -> Result<bool, String>;
    fn delete_share(&self, share_id: &str) -> Result<Option<ShareInfo>, String>;
    fn cleanup_expired_shares(&self) -> Vec<ShareInfo>;
}
```

**注意**: `ShareServiceTrait` 全部方法为同步，**不需要 `#[async_trait]`**，避免不必要的间接调用开销。

**`cleanup_expired_shares` 返回值说明**: 返回被清理的 `Vec<ShareInfo>`，供 `main.rs` 事件监听器记录日志。

#### 2.2.5 AppState 改造

```rust
#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<dyn RoomServiceTrait>,
    pub file_manager: Arc<dyn FileManagerTrait>,
    pub share_service: Arc<dyn ShareServiceTrait>,
    pub start_time: std::time::Instant,
}

impl AppState {
    pub fn new(
        room_service: Arc<dyn RoomServiceTrait>,
        file_manager: Arc<dyn FileManagerTrait>,
        share_service: Arc<dyn ShareServiceTrait>,
    ) -> Self {
        Self {
            room_service,
            file_manager,
            share_service,
            start_time: std::time::Instant::now(),
        }
    }
}
```

生产代码中通过 `Arc::new(RoomService::new()) as Arc<dyn RoomServiceTrait>` 构造。测试中通过 `Arc::new(MockRoomService::new())` 构造。

### 2.3 Routes 模块测试策略

Routes handler 使用 `axum::test` + mock trait 实现进行测试。

```rust
// 测试示例
#[tokio::test]
async fn test_create_room_success() {
    let mock_room_service = Arc::new(MockRoomService::new()) as Arc<dyn RoomServiceTrait>;
    let state = AppState::new(mock_room_service, ...);

    let app = routes::rooms::router().with_state(state);

    let response = app
        .oneshot(Request::builder()
            .method("POST")
            .uri("/api/rooms/create")
            .header("content-type", "application/json")
            .body(r#"{"roomKey":"test1234"}"#)
            .unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
```

**Mock 实现策略**: 使用简单的手动 mock（非 mockall crate），在 `tests/common/mocks/` 目录下创建。每个 mock 使用 `Mutex<Vec<Call>>` 记录调用历史，支持配置返回值。

选择手动 mock 而非 mockall 的原因：

- 零额外依赖
- 更容易理解和调试
- 对 `async_trait` 兼容性更好
- 项目规模不需要 mockall 的高级功能

### 2.4 Socket 模块测试策略

Socket handler 的测试采用组合策略：

#### 2.4.1 提取纯逻辑函数

从 `handle_join_room` 等 handler 中提取不依赖 `SocketRef` 的纯逻辑：

```rust
// 提取前（在 handle_join_room 内部）:
let user_id = match &data.fingerprint {
    Some(fp) => format!("fp_{}", fp.hash),
    None => generate_random_id(),
};
let username = match &data.user {
    Some(u) => match &u.name {
        Some(name) => truncate_username(name),
        None => generate_random_name(),
    },
    None => generate_random_name(),
};

// 提取后（独立函数）:
pub fn resolve_user_id(fingerprint: Option<&FingerprintData>) -> String { ... }
pub fn resolve_username(user_data: Option<&UserData>) -> String { ... }
pub fn resolve_device_type(user_data: Option<&UserData>, user_agent: Option<&str>) -> String { ... }
```

这些纯函数可以用普通单元测试覆盖。

#### 2.4.2 使用 `__test_harness` 集成测试

启用 socketioxide 的 `__test_harness` feature，通过 `SocketIo::new_dummy_sock` 创建虚拟连接，测试完整 handler 链路。

**重要限制**: `new_dummy_sock` 返回的是底层 Engine.IO Packet channel（`mpsc::Sender<Packet>` / `mpsc::Receiver<Packet>`），不是高级 Socket.IO 事件 API。需要：

1. 在 `tests/common/socket_helpers.rs` 中编写 `emit_event` / `recv_event` 辅助封装
2. 封装 Socket.IO 事件编码（将事件名 + JSON payload 编码为 Engine.IO Packet）
3. 封装响应解析（从 Engine.IO Packet 解码出事件名和 JSON 数据）

```rust
// 辅助封装后的测试示例
#[tokio::test]
async fn test_join_room_via_socket() {
    let room_service = Arc::new(RoomService::new()) as Arc<dyn RoomServiceTrait>;
    let (_, io) = SocketIo::new_svc();
    setup_socket_handlers(&io, room_service.clone());

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    // 等待 connect ack
    wait_for_connect(&mut srx).await;

    // 通过辅助函数发送/接收 Socket.IO 事件
    emit_event(&stx, "joinRoom", json!({"roomKey": "test1234"})).await;
    let response = recv_event(&mut srx).await;
    assert_eq!(response.event, "userJoined");
}
```

**为 `__test_harness` 调用封装 abstraction 层**，放在 `tests/common/socket_helpers.rs`。如果 socketioxide 版本升级，只需修改这一个文件。

#### 2.4.3 消除 handle_join_room / handle_join_room_with_password 重复

将两个函数的公共逻辑提取为 `join_room_core`，两个 handler 只负责参数适配和 Socket I/O。

#### 2.4.4 SocketRateLimiter 单元测试

`SocketRateLimiter` 已有内联测试覆盖基本场景，补充以下边界测试：

- `max_requests = 0` 的行为
- 多事件类型混合限速
- `cleanup` 在边界时间点的行为

### 2.5 各模块具体测试计划

#### 2.5.1 error.rs（4.0% → 80%+）

**工作量**: 小（约 5 个新测试）

- 补充 `into_response()` 的完整 JSON body 验证（每个变体验证 `success`、`message`、`data` 字段）
- 验证 `TooManyRequests` / `LockError` 的硬编码消息
- 验证 `From<String>` / `From<anyhow::Error>` 的端到端消息传播

#### 2.5.2 models/message.rs（65.2% → 80%+）

**工作量**: 小（约 6 个新测试）

- `skip_serializing_if` 验证：Optional 字段为 None 时 JSON 中省略
- File 消息和 System 消息的完整序列化往返
- `file_id: Some(...)` 的序列化覆盖
- `MessageSender::from_user` 中 fingerprint 为 Some 的情况
- 反序列化容错（无效 type 值）

#### 2.5.3 middleware/rate_limit.rs（0.0% → 80%+）

**工作量**: 中（约 10 个新测试）

- `RateLimitService::call` 的放行/拒绝分支（通过 `tower::ServiceExt` 测试）
- `RateLimitConfig::from_env` 环境变量组合测试（需隔离环境变量）
- `rate_limit_exceeded_response` 的 JSON body 内容验证
- `RateLimitMiddleware` 作为 `tower::Layer` 的集成测试

#### 2.5.4 routes/rooms.rs（0.0% → 80%+）

**工作量**: 中（约 20 个新测试）

- `create_room`：成功、key 格式无效、房间已存在
- `get_room_info`：成功、key 缺失、房间不存在
- `get_room_users`：成功、空房间
- `get_room_messages`：成功、带 limit、无 limit、空消息
- `validate_user`：用户存在、不存在、房间不存在
- `get_room_by_path`：成功、不存在
- `room_exists`：存在、不存在
- `verify_password`：正确、错误、房间不存在

#### 2.5.5 routes/files.rs（10.5% → 80%+）

**工作量**: 大（约 25 个新测试）

- `upload_file`：成功上传、文件名无效、危险扩展名、文件过大、magic bytes 拦截、重复文件、room_key 缺失
- `download_file`：成功下载、文件 ID 无效、文件不存在、符号链接拦截、路径遍历拦截、非 ASCII 文件名
- `delete_file`：成功删除、room_key 缺失、文件不存在、跨房间访问拒绝

**注意**: 文件系统操作使用临时目录（`tempfile::tempdir()`），不 mock FileManager。

#### 2.5.6 routes/share.rs（0.0% → 80%+）

**工作量**: 大（约 30 个新测试）

- `create_share`：成功（有/无密码）、过期范围无效、文件不存在
- `list_shares`：按状态过滤、分页、空列表
- `get_share`：成功、不存在
- `delete_share`：成功、非所有者、不存在
- `permanent_delete`：成功、非所有者、不存在
- `get_access_logs`：成功、空日志
- `get_user_shares`：成功、空列表
- `public_download`：成功下载、密码保护（正确/错误/未提供）、过期分享、文件不存在、shareId 格式无效

**注意**: `public_download` 中的 `StreamGuard` 和 `BandwidthTracker` 已有内联测试覆盖，handler 测试重点在业务分支。

#### 2.5.7 services/socket.rs（0.0% → 75%+）

**工作量**: 最大（约 35 个新测试）

**纯逻辑函数测试**（约 15 个）：

- `resolve_user_id`：有/无 fingerprint
- `resolve_username`：有/无 name、截断、后缀生成
- `resolve_device_type`：有/无 device_type、User-Agent 回退
- `join_room_core`：成功、房间需要密码、密码错误
- 其他提取出的纯逻辑函数

**集成测试**（约 20 个，使用 `__test_harness`）：

- `joinRoom`：成功加入、密码保护、重复用户名
- `sendMessage`：文本消息、文件消息
- `leaveRoom`：成功离开
- `disconnect`：用户离线
- `setRoomPassword`：设置/移除密码
- `recallMessage`：成功撤回、非发送者撤回
- `pinRoom`：置顶/取消置顶
- P2P 信令：同房间转发、跨房间拒绝

## 3. 实施阶段

### 阶段 1：基础设施（预计 3-4 天）

1. 将 `JoinRoomRequest<'a>` 改造为 owning 版本（消除生命周期）
2. 修改所有使用 `JoinRoomRequest` 的代码（room_service.rs、socket.rs、测试文件）
3. 定义 `RoomServiceTrait`、`FileManagerTrait`、`ShareServiceTrait`
4. 为现有实现添加 `impl Trait for ConcreteType`
5. 改造 `AppState` 使用 `Arc<dyn Trait>`，添加 `AppState::new()` 构造函数
6. 修改 `main.rs` 中的构造代码
7. 处理 `schedule_room_destroy_check`：保持 `&Arc<Self>` 签名不变，socket handler 中继续使用具体类型调用
8. 创建 `tests/common/mocks/` 目录和基础 mock 实现
9. 启用 `__test_harness` feature（dev-dependencies）
10. 确保现有测试全部通过
11. 手动启动 Docker 容器做端到端冒烟验证（创建房间、发送消息、上传文件等核心流程）

### 阶段 2：简单模块（预计 1 天）

1. `error.rs` — 补充 `into_response()` JSON body 测试
2. `models/message.rs` — 补充序列化边界测试
3. `middleware/rate_limit.rs` — 补充 `RateLimitService::call` 测试

### 阶段 3：Routes 模块（预计 2-3 天）

1. `routes/rooms.rs` — 所有 handler 的集成测试
2. `routes/files.rs` — 文件上传/下载/删除测试
3. `routes/share.rs` — 分享 CRUD + 下载测试

### 阶段 4：Socket 模块（预计 3-5 天）

1. 编写 Socket.IO Packet 编解码辅助函数（`tests/common/socket_helpers.rs`）
2. 提取纯逻辑函数
3. 消除 `handle_join_room` / `handle_join_room_with_password` 重复
4. 纯逻辑函数单元测试
5. `__test_harness` 集成测试

### 阶段 5：验证与清理（预计 1 天）

1. 运行完整覆盖率报告
2. 确认所有 7 个模块达到目标覆盖率
3. 清理旧的无效测试文件（`tests/socket_service_tests.rs` 等），前提：新增测试已达到等效或更优的覆盖率
4. 更新文档

## 4. 风险与缓解

| 风险                                      | 影响                          | 缓解措施                                                                                                                              |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `__test_harness` 是不稳定 API             | socketioxide 升级可能破坏测试 | 为 `__test_harness` 调用封装 abstraction 层（`tests/common/socket_helpers.rs`），版本升级时只需修改一个文件；优先用纯逻辑函数测试覆盖 |
| `__test_harness` 存在严重 bug             | 可能无法使用                  | 备选方案：放弃 socket 集成测试，改用真实 TCP 连接（`tokio-tungstenite`）或仅依赖纯函数测试（此时 socket.rs 目标下调至约 60%）         |
| `JoinRoomRequest` 改造影响面广            | 可能引入编译错误              | 逐文件修改，每步编译验证；builder 方法签名保持兼容                                                                                    |
| `upload_dir() -> &Path` 改为 `-> PathBuf` | 轻微性能影响                  | 每次调用一次 clone，可忽略                                                                                                            |
| AppState 改为 trait object                | 动态分发开销                  | 仅在 Arc 内间接调用，开销可忽略                                                                                                       |
| 重构引入 bug                              | 现有功能回归                  | 每个阶段完成后运行全量测试 + Docker 端到端冒烟验证；阶段 1 完成后特别关注手动验证                                                     |

### 非核心模块说明

- `config.rs`（91.7%）和 `utils/*.rs`（100%）已达标，无需额外工作
- `routes/health.rs` 和 `routes/api_info.rs` 代码量极小，如需要可在阶段 3 末尾快速补充
- `main.rs` 排除在目标外，启动入口测试价值低

## 5. 预期覆盖率目标

| 模块                       | 当前  | 目标 |
| -------------------------- | ----- | ---- |
| `error.rs`                 | 4.0%  | 85%+ |
| `models/message.rs`        | 65.2% | 85%+ |
| `middleware/rate_limit.rs` | 0.0%  | 80%+ |
| `routes/rooms.rs`          | 0.0%  | 80%+ |
| `routes/files.rs`          | 10.5% | 80%+ |
| `routes/share.rs`          | 0.0%  | 80%+ |
| `services/socket.rs`       | 0.0%  | 75%+ |

**说明**: `socket.rs` 目标设为 75%+ 而非 80%，因为 `setup_socket_handlers` 中的事件注册模板代码（约 317 行重复的限速检查逻辑）覆盖率提升性价比低，且核心业务逻辑已通过纯函数测试覆盖。
