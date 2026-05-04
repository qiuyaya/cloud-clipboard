# 后端关键模块测试覆盖率提升至 80% 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 7 个核心业务模块的测试覆盖率提升至 80%+，通过 trait 抽象和纯函数提取实现可测试性

**Architecture:** 为三个服务定义 trait（RoomServiceTrait、FileManagerTrait、ShareServiceTrait），AppState 改为持有 `Arc<dyn Trait>`，handler 通过 mock trait 进行单元测试。Socket handler 提取纯逻辑函数 + `__test_harness` 集成测试。

**Tech Stack:** Rust 1.93, Axum 0.8, SocketiOxide 0.15, tower, async-trait, tempfile

**Spec:** `docs/superpowers/specs/2026-05-04-test-coverage-design.md`

---

## File Structure

### 新建文件

| 文件                                  | 职责                                                       |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/services/traits.rs`              | RoomServiceTrait、FileManagerTrait、ShareServiceTrait 定义 |
| `tests/common/mocks/mod.rs`           | Mock 模块入口                                              |
| `tests/common/mocks/room_service.rs`  | MockRoomService 实现                                       |
| `tests/common/mocks/file_manager.rs`  | MockFileManager 实现                                       |
| `tests/common/mocks/share_service.rs` | MockShareService 实现                                      |
| `tests/common/socket_helpers.rs`      | Socket.IO Packet 编解码辅助                                |
| `tests/common/test_app.rs`            | 测试用 AppState 构造辅助                                   |

### 修改文件

| 文件                            | 变更                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `src/services/room_service.rs`  | JoinRoomRequest 改为 owning；impl RoomServiceTrait                         |
| `src/services/file_manager.rs`  | impl FileManagerTrait；upload_dir 返回 PathBuf                             |
| `src/services/share_service.rs` | impl ShareServiceTrait                                                     |
| `src/services/mod.rs`           | 添加 traits 模块导出                                                       |
| `src/services/socket.rs`        | 提取纯逻辑函数；JoinRoomRequest 改为 owning                                |
| `src/lib.rs`                    | AppState 改为 Arc<dyn Trait>；添加 new()                                   |
| `src/main.rs`                   | 构造代码适配                                                               |
| `src/routes/rooms.rs`           | 适配 dyn Trait 调用                                                        |
| `src/routes/files.rs`           | 适配 dyn Trait 调用                                                        |
| `src/routes/share.rs`           | 适配 dyn Trait 调用                                                        |
| `src/routes/health.rs`          | 适配 dyn Trait 调用                                                        |
| `src/error.rs`                  | 补充 into_response JSON body 测试                                          |
| `src/models/message.rs`         | 补充序列化边界测试                                                         |
| `src/middleware/rate_limit.rs`  | 补充 RateLimitService::call 测试                                           |
| `Cargo.toml`                    | 添加 async-trait 依赖；dev-dependencies 添加 socketioxide \_\_test_harness |
| `tests/common/mod.rs`           | 适配 JoinRoomRequest owning 版本                                           |
| `tests/integration_tests.rs`    | 适配 JoinRoomRequest owning 版本                                           |
| `tests/concurrency_tests.rs`    | 适配 JoinRoomRequest owning 版本                                           |
| `tests/room_service_tests.rs`   | 适配 JoinRoomRequest owning 版本                                           |

---

## Task 1: JoinRoomRequest 改为 owning 版本

**Files:**

- Modify: `src/services/room_service.rs:28-67`
- Test: `src/services/room_service.rs` (内联测试)

- [ ] **Step 1: 修改 JoinRoomRequest 结构体定义**

将 `src/services/room_service.rs` 第 28-37 行改为：

```rust
#[derive(Debug, Clone)]
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

**注意**: 移除 `#[derive(Serialize, Deserialize)]`（如果存在）。JoinRoomRequest 是内部构造的请求对象，不直接从 HTTP body 反序列化。

- [ ] **Step 2: 修改 JoinRoomRequest impl 块**

将第 39-67 行改为：

```rust
impl JoinRoomRequest {
    pub fn new(room_key: impl Into<String>, user_id: impl Into<String>, username: impl Into<String>, socket_id: impl Into<String>) -> Self {
        Self {
            room_key: room_key.into(),
            user_id: user_id.into(),
            username: username.into(),
            socket_id: socket_id.into(),
            password: None,
            device_type: "desktop".to_string(),
            fingerprint: None,
        }
    }

    pub fn with_password(mut self, password: impl Into<String>) -> Self {
        self.password = Some(password.into());
        self
    }

    pub fn with_fingerprint(mut self, fingerprint: impl Into<String>) -> Self {
        self.fingerprint = Some(fingerprint.into());
        self
    }

    pub fn with_device_type(mut self, device_type: impl Into<String>) -> Self {
        self.device_type = device_type.into();
        self
    }
}
```

- [ ] **Step 3: 修改 join_room 方法签名**

将第 176 行的 `fn join_room(&self, req: JoinRoomRequest)` 签名保持不变（JoinRoomRequest 已无生命周期参数）。

- [ ] **Step 4: 修改 join_room 方法内部对 JoinRoomRequest 字段的引用**

将方法内部所有 `req.room_key`、`req.user_id` 等直接使用（它们现在是 `String` 而非 `&str`），需要调用的地方加 `.as_str()` 或 `&*`。具体位置需逐行检查 `join_room` 方法体（第 176-260 行）。

- [ ] **Step 5: 修改 room_service.rs 内联测试**

所有 `JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")` 调用保持不变（`&str` 可自动转换为 `impl Into<String>`）。`.with_password("pwd")` 同理。但 `fingerprint_hash: Option<&'a str>` 改为 `Option<String>` 后，构造处需检查。

- [ ] **Step 6: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1 | head -50`

Expected: 编译错误在其他文件中（socket.rs、tests/），这些在后续步骤修复

- [ ] **Step 7: Commit**

```bash
git add server-rust/src/services/room_service.rs
git commit -m "refactor: JoinRoomRequest 改为 owning 版本，消除生命周期参数"
```

---

## Task 2: 适配 socket.rs 中的 JoinRoomRequest 使用

**Files:**

- Modify: `src/services/socket.rs:653-661,774-782`

- [ ] **Step 1: 修改 handle_join_room 中的 JoinRoomRequest 构造**

将第 653-661 行改为：

```rust
let join_req = JoinRoomRequest {
    room_key: data.room_key.clone(),
    user_id: user_id.clone(),
    username: username.clone(),
    socket_id: socket_id.clone(),
    password: None,
    device_type: device_type.clone(),
    fingerprint: fingerprint_hash.map(|s| s.to_string()),
};
```

- [ ] **Step 2: 修改 handle_join_room_with_password 中的 JoinRoomRequest 构造**

将第 774-782 行改为：

```rust
let join_req = JoinRoomRequest {
    room_key: data.room_key.clone(),
    user_id: user_id.clone(),
    username: username.clone(),
    socket_id: socket_id.clone(),
    password: Some(data.password.clone()),
    device_type: device_type.clone(),
    fingerprint: fingerprint_hash.map(|s| s.to_string()),
};
```

- [ ] **Step 3: 检查 fingerprint_hash 变量类型**

`fingerprint_hash` 当前类型为 `Option<&str>`（来自 `data.fingerprint.as_ref().map(|f| f.hash.as_str())`），需改为 `Option<String>`：

```rust
let fingerprint_hash = data.fingerprint.as_ref().map(|f| f.hash.clone());
```

此修改在两处 handler 中都需要做（约第 649 行和第 770 行）。

- [ ] **Step 4: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1 | head -50`

- [ ] **Step 5: Commit**

```bash
git add server-rust/src/services/socket.rs
git commit -m "refactor: socket handler 适配 JoinRoomRequest owning 版本"
```

---

## Task 3: 适配测试文件中的 JoinRoomRequest 使用

**Files:**

- Modify: `tests/common/mod.rs`
- Modify: `tests/integration_tests.rs`
- Modify: `tests/concurrency_tests.rs`
- Modify: `tests/room_service_tests.rs`

- [ ] **Step 1: 修改 tests/common/mod.rs**

将 `create_user_and_join_room` 辅助函数中的 `JoinRoomRequest` 构造适配 owning 版本。`JoinRoomRequest::new()` 的参数现在接受 `impl Into<String>`，所以 `&str` 字面量仍然兼容。检查 `fingerprint` 相关字段。

- [ ] **Step 2: 修改 tests/integration_tests.rs**

所有 `JoinRoomRequest::new(...)` 调用保持不变。检查 `with_fingerprint("fp1")` 等 builder 调用是否兼容。

- [ ] **Step 3: 修改 tests/concurrency_tests.rs**

同上。

- [ ] **Step 4: 修改 tests/room_service_tests.rs**

同上。这是使用 JoinRoomRequest 最多的文件（20+ 处），需逐处检查。

- [ ] **Step 5: 运行全量测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features 2>&1 | tail -30`

Expected: 所有测试通过

- [ ] **Step 6: Commit**

```bash
git add server-rust/tests/
git commit -m "refactor: 测试文件适配 JoinRoomRequest owning 版本"
```

---

## Task 4: 定义服务 Trait

**Files:**

- Create: `src/services/traits.rs`
- Modify: `src/services/mod.rs`
- Modify: `Cargo.toml`

- [ ] **Step 1: 添加 async-trait 依赖**

在 `Cargo.toml` 的 `[dependencies]` 中添加：

```toml
async-trait = "0.1"
```

- [ ] **Step 2: 创建 src/services/traits.rs**

```rust
use crate::models::*;
use crate::services::room_service::{JoinRoomRequest, RoomEvent, RoomInfo, RoomStats};
use crate::services::file_manager::{FileInfo, FileStats, StorageUsage};
use crate::services::share_service::{CreateShareRequest, ShareAccessLog, ShareInfo, ShareInfoResponse};
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::sync::broadcast;

// 注意: RoomServiceTrait 全部方法为同步，不需要 #[async_trait]
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

// FileManagerTrait 包含 async 方法，需要 #[async_trait]
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

- [ ] **Step 3: 更新 src/services/mod.rs**

添加 `pub mod traits;` 和 re-export：

```rust
pub mod file_manager;
pub mod room_service;
pub mod share_service;
pub mod socket;
pub mod storage;
pub mod traits;

pub use file_manager::FileManager;
pub use room_service::{JoinRoomRequest, RoomEvent, RoomService};
pub use share_service::{CreateShareRequest, ShareService};
pub use traits::{FileManagerTrait, RoomServiceTrait, ShareServiceTrait};
```

- [ ] **Step 4: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1 | head -50`

Expected: traits.rs 本身能编译，但其他文件（socket.rs、tests/）可能因 JoinRoomRequest 生命周期变更报错——这些在 Task 2/3 中修复

- [ ] **Step 5: Commit**

```bash
git add server-rust/src/services/traits.rs server-rust/src/services/mod.rs server-rust/Cargo.toml
git commit -m "feat: 定义 RoomServiceTrait、FileManagerTrait、ShareServiceTrait"
```

---

## Task 5: 为现有服务实现 Trait

**Files:**

- Modify: `src/services/room_service.rs`
- Modify: `src/services/file_manager.rs`
- Modify: `src/services/share_service.rs`

- [ ] **Step 1: 为 RoomService 实现 RoomServiceTrait**

在 `src/services/room_service.rs` 末尾（内联测试之前）添加：

```rust
impl RoomServiceTrait for RoomService {
    fn create_room(&self, room_key: &str, password: Option<&str>, creator_fingerprint: Option<&str>) -> Result<RoomInfo, String> {
        Self::create_room(self, room_key, password, creator_fingerprint)
    }
    fn get_room_info(&self, room_key: &str) -> Option<RoomInfo> {
        Self::get_room_info(self, room_key)
    }
    // ... 所有方法都委托给 Self 的同名方法
}
```

**注意**: `RoomServiceTrait` 全部方法为同步，不需要 `#[async_trait]`。直接 `impl RoomServiceTrait for RoomService` 即可。

- [ ] **Step 2: 为 FileManager 实现 FileManagerTrait**

在 `src/services/file_manager.rs` 末尾添加。注意 `upload_dir` 需要返回 `PathBuf` 而非 `&Path`：

```rust
#[async_trait::async_trait]
impl FileManagerTrait for FileManager {
    fn upload_dir(&self) -> PathBuf {
        Self::upload_dir(self).to_path_buf()
    }
    // async 方法直接委托
    async fn save_file(&self, room_key: &str, original_name: &str, mime_type: &str, data: &[u8]) -> anyhow::Result<FileInfo> {
        Self::save_file(self, room_key, original_name, mime_type, data).await
    }
    // ... 其他方法
}
```

- [ ] **Step 3: 为 ShareService 实现 ShareServiceTrait**

在 `src/services/share_service.rs` 末尾添加：

```rust
impl ShareServiceTrait for ShareService {
    fn create_share(&self, req: CreateShareRequest) -> Result<(ShareInfo, Option<String>), String> {
        Self::create_share(self, req)
    }
    // ... 其他方法
}
```

- [ ] **Step 4: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1 | head -50`

- [ ] **Step 5: 运行全量测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features 2>&1 | tail -30`

- [ ] **Step 6: Commit**

```bash
git add server-rust/src/services/
git commit -m "feat: 为 RoomService、FileManager、ShareService 实现 trait"
```

---

## Task 6: 改造 AppState

**Files:**

- Modify: `src/lib.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: 修改 AppState 定义**

将 `src/lib.rs` 中的 AppState 改为：

```rust
use crate::services::traits::{FileManagerTrait, RoomServiceTrait, ShareServiceTrait};
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<dyn RoomServiceTrait>,
    pub file_manager: Arc<dyn FileManagerTrait>,
    pub share_service: Arc<dyn ShareServiceTrait>,
    pub start_time: Instant,
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
            start_time: Instant::now(),
        }
    }
}
```

- [ ] **Step 2: 修改 main.rs 中的 AppState 构造**

将第 59-76 行改为：

```rust
let room_service = Arc::new(RoomService::new());
let file_manager = Arc::new(FileManager::new()?);
let share_service = Arc::new(ShareService::new());

let app_state = AppState::new(
    room_service.clone() as Arc<dyn RoomServiceTrait>,
    file_manager.clone() as Arc<dyn FileManagerTrait>,
    share_service.clone() as Arc<dyn ShareServiceTrait>,
);
```

- [ ] **Step 3: 修改 main.rs 中 setup_socket_handlers 调用**

保持 `setup_socket_handlers(&io, room_service.clone())` 不变——`room_service` 仍然是 `Arc<RoomService>` 具体类型。

- [ ] **Step 4: 修改 main.rs 中事件监听器的服务调用**

main.rs 中的事件监听器（RoomDestroyed 事件触发 file_manager.delete_room_files 等）使用的是 `Arc<FileManager>` 和 `Arc<ShareService>` 具体类型。这些需要保持不变，因为 `room_service.subscribe()` 返回的 `RoomEvent` 处理中调用的方法在 trait 中都有。

但 main.rs 中的后台清理任务也需要适配。检查第 358-425 行的清理代码，确保 `Arc<FileManager>` 和 `Arc<ShareService>` 的方法调用兼容。

- [ ] **Step 5: 编译检查并修复所有编译错误**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1`

逐个修复编译错误。主要问题可能是：

- 路由 handler 中通过 `state.room_service.xxx()` 调用的方法，现在 `room_service` 是 `Arc<dyn RoomServiceTrait>`，方法签名需匹配 trait
- `state.file_manager.upload_dir()` 现在返回 `PathBuf` 而非 `&Path`，需适配调用处

- [ ] **Step 6: 运行全量测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add server-rust/src/
git commit -m "refactor: AppState 改为持有 Arc<dyn Trait>，支持 mock 测试"
```

---

## Task 7: 创建 Mock 实现

**Files:**

- Create: `tests/common/mocks/mod.rs`
- Create: `tests/common/mocks/room_service.rs`
- Create: `tests/common/mocks/file_manager.rs`
- Create: `tests/common/mocks/share_service.rs`
- Create: `tests/common/test_app.rs`
- Modify: `tests/common/mod.rs`

- [ ] **Step 1: 创建 MockRoomService**

在 `tests/common/mocks/room_service.rs` 中创建手动 mock：

```rust
use cloud_clipboard_server::services::RoomServiceTrait;
use cloud_clipboard_server::models::*;
use cloud_clipboard_server::services::room_service::{JoinRoomRequest, RoomEvent, RoomInfo, RoomStats};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct RoomServiceCall {
    pub method: String,
    pub room_key: Option<String>,
}

pub struct MockRoomService {
    calls: Mutex<Vec<RoomServiceCall>>,
    rooms: Mutex<std::collections::HashMap<String, RoomInfo>>,
    event_sender: broadcast::Sender<RoomEvent>,
}

impl MockRoomService {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(16);
        Self {
            calls: Mutex::new(Vec::new()),
            rooms: Mutex::new(std::collections::HashMap::new()),
            event_sender: tx,
        }
    }

    pub fn add_room(&self, room_key: &str, info: RoomInfo) {
        self.rooms.lock().unwrap().insert(room_key.to_string(), info);
    }

    pub fn get_calls(&self) -> Vec<RoomServiceCall> {
        self.calls.lock().unwrap().clone()
    }

    fn record_call(&self, method: &str, room_key: Option<&str>) {
        self.calls.lock().unwrap().push(RoomServiceCall {
            method: method.to_string(),
            room_key: room_key.map(|s| s.to_string()),
        });
    }
}

impl RoomServiceTrait for MockRoomService {
    fn create_room(&self, room_key: &str, _password: Option<&str>, _creator_fingerprint: Option<&str>) -> Result<RoomInfo, String> {
        self.record_call("create_room", Some(room_key));
        let info = self.rooms.lock().unwrap().get(room_key).cloned();
        match info {
            Some(_) => Err("Room already exists".to_string()),
            None => {
                let info = RoomInfo {
                    room_key: room_key.to_string(),
                    user_count: 0,
                    has_password: false,
                    created_at: chrono::Utc::now(),
                    last_activity: chrono::Utc::now(),
                    is_pinned: false,
                };
                self.rooms.lock().unwrap().insert(room_key.to_string(), info.clone());
                Ok(info)
            }
        }
    }

    fn get_room_info(&self, room_key: &str) -> Option<RoomInfo> {
        self.record_call("get_room_info", Some(room_key));
        self.rooms.lock().unwrap().get(room_key).cloned()
    }

    fn room_exists(&self, room_key: &str) -> bool {
        self.record_call("room_exists", Some(room_key));
        self.rooms.lock().unwrap().contains_key(room_key)
    }

    fn room_has_password(&self, _room_key: &str) -> bool { false }
    fn get_room_password(&self, _room_key: &str) -> Option<String> { None }
    fn verify_room_password(&self, _room_key: &str, _password: &str) -> Result<bool, String> { Ok(false) }
    fn join_room(&self, _req: JoinRoomRequest) -> Result<(User, Vec<User>), String> { Err("Not implemented".to_string()) }
    fn get_room_users(&self, _room_key: &str) -> Vec<User> { vec![] }
    fn get_messages(&self, _room_key: &str) -> Vec<Message> { vec![] }
    fn find_user_by_fingerprint(&self, _room_key: &str, _fingerprint_hash: &str) -> Option<User> { None }
    fn get_room_stats(&self) -> RoomStats { RoomStats { total_rooms: 0, total_users: 0, online_users: 0 } }
    fn add_message(&self, _room_key: &str, _message: Message) -> Result<(), String> { Ok(()) }
    fn remove_message(&self, _room_key: &str, _message_id: &str) -> Result<bool, String> { Ok(false) }
    fn get_message_sender(&self, _room_key: &str, _message_id: &str) -> Option<String> { None }
    fn get_user_by_socket(&self, _socket_id: &str) -> Option<User> { None }
    fn get_socket_by_user(&self, _user_id: &str) -> Option<String> { None }
    fn set_room_password(&self, _room_key: &str, _password: Option<&str>) -> Result<bool, String> { Ok(true) }
    fn pin_room(&self, _room_key: &str, _fingerprint: &str) -> Result<bool, String> { Ok(true) }
    fn unpin_room(&self, _room_key: &str, _fingerprint: &str) -> Result<bool, String> { Ok(true) }
    fn is_room_pinned(&self, _room_key: &str) -> bool { false }
    fn update_user_status(&self, _room_key: &str, _user_id: &str, _is_online: bool) {}
    fn leave_room(&self, _socket_id: &str) -> Option<(String, User)> { None }
    fn set_user_offline(&self, _socket_id: &str) -> Option<(String, User)> { None }
    fn subscribe(&self) -> broadcast::Receiver<RoomEvent> { self.event_sender.subscribe() }
    fn cleanup_inactive_rooms(&self) -> Vec<String> { vec![] }
}
```

- [ ] **Step 2: 创建 MockFileManager**

在 `tests/common/mocks/file_manager.rs` 中创建。重点 mock `get_file`、`upload_dir`、`max_file_size`、`save_file`、`delete_file`。

- [ ] **Step 3: 创建 MockShareService**

在 `tests/common/mocks/share_service.rs` 中创建。重点 mock `create_share`、`get_share`、`verify_password`、`record_access`、`revoke_share`、`delete_share`。

- [ ] **Step 4: 创建测试辅助**

在 `tests/common/test_app.rs` 中：

```rust
use cloud_clipboard_server::AppState;
use cloud_clipboard_server::services::traits::*;
use std::sync::Arc;

pub fn create_test_app_state(
    room_service: Arc<dyn RoomServiceTrait>,
    file_manager: Arc<dyn FileManagerTrait>,
    share_service: Arc<dyn ShareServiceTrait>,
) -> AppState {
    AppState::new(room_service, file_manager, share_service)
}
```

- [ ] **Step 5: 更新 tests/common/mod.rs**

添加 `pub mod mocks;` 和 `pub mod test_app;`。

- [ ] **Step 6: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --no-run 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add server-rust/tests/common/
git commit -m "test: 创建 Mock 服务实现和测试辅助"
```

---

## Task 8: 补充 error.rs 测试

**Files:**

- Modify: `src/error.rs:80-157`

- [ ] **Step 1: 编写 into_response JSON body 验证测试**

在 `src/error.rs` 的 `mod tests` 中添加：

```rust
#[tokio::test]
async fn into_response_json_body_not_found() {
    let error = AppError::NotFound("Resource not found".to_string());
    let response = error.into_response();
    let (parts, body) = response.into_parts();
    assert_eq!(parts.status(), StatusCode::NOT_FOUND);
    let body_bytes = axum::body::to_bytes(body, 1024).await.unwrap();
    let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_json["success"], false);
    assert_eq!(body_json["message"], "Resource not found");
    assert!(body_json["data"].is_null());
}
```

对每个变体（BadRequest、Unauthorized、Forbidden、TooManyRequests、Internal、LockError、Io）都写一个类似的测试。

- [ ] **Step 2: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test error --all-features 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add server-rust/src/error.rs
git commit -m "test: 补充 AppError into_response JSON body 验证测试"
```

---

## Task 9: 补充 models/message.rs 测试

**Files:**

- Modify: `src/models/message.rs:140-271`

- [ ] **Step 1: 编写 skip_serializing_if 测试**

```rust
#[test]
fn message_optional_fields_omitted_when_none() {
    let sender = MessageSender::system();
    let msg = Message::new_text("room1".to_string(), sender, "hello".to_string());
    let json = serde_json::to_string(&msg).unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert!(!value.as_object().unwrap().contains_key("fileInfo"));
    assert!(!value.as_object().unwrap().contains_key("downloadUrl"));
    assert!(!value.as_object().unwrap().contains_key("fileId"));
}
```

- [ ] **Step 2: 编写文件消息序列化往返测试**

```rust
#[test]
fn file_message_serialization_roundtrip() {
    let sender = MessageSender::system();
    let file_info = crate::models::message::FileInfo {
        name: "test.pdf".to_string(),
        size: 1024,
        file_type: "application/pdf".to_string(),
        last_modified: Some(chrono::Utc::now().timestamp_millis()),
    };
    let msg = Message::new_file("room1".to_string(), sender, file_info, "http://example.com/file".to_string());
    let json = serde_json::to_string(&msg).unwrap();
    let deserialized: Message = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.id, msg.id);
    assert!(deserialized.content.is_none());
    assert!(deserialized.file_info.is_some());
    assert!(deserialized.download_url.is_some());
}
```

**注意**: `Message::new_file` 使用的是 `models::message::FileInfo`（含 `name`/`size`/`file_type`/`last_modified`），不是 `services::file_manager::FileInfo`（含 `filename`/`original_name` 等）。

- [ ] **Step 3: 编写 MessageType 反序列化容错测试**

```rust
#[test]
fn message_type_invalid_value_fails() {
    let json = r#""unknown""#;
    let result: Result<MessageType, _> = serde_json::from_str(json);
    assert!(result.is_err());
}
```

- [ ] **Step 4: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test message --all-features 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add server-rust/src/models/message.rs
git commit -m "test: 补充 Message 序列化边界和容错测试"
```

---

## Task 10: 补充 middleware/rate_limit.rs 测试

**Files:**

- Modify: `src/middleware/rate_limit.rs:284-518`

- [ ] **Step 1: 编写 RateLimitService::call 放行测试**

```rust
#[tokio::test]
async fn rate_limit_service_allows_request_within_limit() {
    use tower::ServiceExt;

    let config = RateLimitConfig::default();
    let limiter = create_rate_limiter(&config, 100);
    // 使用 axum::routing::get 创建简单 handler
    let inner = axum::routing::get(|| async { "ok" });
    let service = RateLimitService::new(inner, limiter, config.clone());

    // 使用 axum::Router 包装测试
    let app = axum::Router::new()
        .route("/test", service)
        .layer(axum::middleware::from_fn(rate_limit_middleware));

    let response = app
        .oneshot(Request::builder()
            .uri("/test")
            .header("x-forwarded-for", "127.0.0.1")
            .body(axum::body::Body::empty())
            .unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
```

**注意**: 具体的 `RateLimitService` 构造方式需参考源码中的实际 API。如果 `RateLimitService` 是一个 tower middleware layer，则应使用 `axum::Router::layer()` 方式集成。

- [ ] **Step 2: 编写 RateLimitService::call 拒绝测试**

构造一个极小配额的 limiter（1 次/分钟），发送 2 次请求，第二次应返回 429。

- [ ] **Step 3: 编写 rate_limit_exceeded_response JSON body 验证**

```rust
#[test]
fn exceeded_response_json_body() {
    let config = RateLimitConfig::default();
    let response = rate_limit_exceeded_response(&config, 30);
    let (parts, body) = response.into_parts();
    assert_eq!(parts.status(), StatusCode::TOO_MANY_REQUESTS);
    // 使用 tokio runtime 读取 body
    let rt = tokio::runtime::Runtime::new().unwrap();
    let body_bytes = rt.block_on(axum::body::to_bytes(body, 1024)).unwrap();
    let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body_json["success"], false);
    assert_eq!(body_json["error"], "RATE_LIMIT_EXCEEDED");
    assert_eq!(body_json["message"], "Too many requests. Please try again later.");
    assert_eq!(body_json["retryAfter"], 30);
}
```

- [ ] **Step 4: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test rate_limit --all-features 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add server-rust/src/middleware/rate_limit.rs
git commit -m "test: 补充 RateLimitService::call 和响应 body 测试"
```

---

## Task 11: routes/rooms.rs 集成测试

**Files:**

- Create: `tests/rooms_handler_tests.rs`

- [ ] **Step 1: 编写 create_room 成功测试**

使用 MockRoomService 构造 AppState，通过 `tower::ServiceExt::oneshot` 发送 POST 请求到 `/api/rooms/create`。

- [ ] **Step 2: 编写 create_room 失败测试**

- key 格式无效（纯数字）
- 房间已存在

- [ ] **Step 3: 编写 get_room_info 测试**

- 成功（mock 返回 Some）
- 房间不存在（mock 返回 None）
- 缺少 x-room-key header

- [ ] **Step 4: 编写 get_room_messages 带 limit 测试**

- [ ] **Step 5: 编写 validate_user 测试**

- 用户存在
- 用户不存在
- 房间不存在

- [ ] **Step 6: 编写 verify_password 测试**

- [ ] **Step 7: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test rooms_handler --all-features 2>&1 | tail -20`

- [ ] **Step 8: Commit**

```bash
git add server-rust/tests/rooms_handler_tests.rs
git commit -m "test: 添加 rooms 路由 handler 集成测试"
```

---

## Task 12: routes/files.rs 集成测试

**Files:**

- Create: `tests/files_handler_tests.rs`

- [ ] **Step 1: 编写 upload_file 成功测试**

使用 tempfile 创建临时目录，构造真实的 FileManager（非 mock），发送 multipart 请求。

- [ ] **Step 2: 编写 upload_file 失败测试**

- 文件名无效（含 `..`）
- 危险扩展名（`.exe`）
- 文件过大
- 缺少 room_key

- [ ] **Step 3: 编写 download_file 测试**

- 成功下载
- 文件 ID 无效
- 文件不存在

- [ ] **Step 4: 编写 delete_file 测试**

- 成功删除
- 跨房间访问拒绝

- [ ] **Step 5: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test files_handler --all-features 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add server-rust/tests/files_handler_tests.rs
git commit -m "test: 添加 files 路由 handler 集成测试"
```

---

## Task 13: routes/share.rs 集成测试

**Files:**

- Create: `tests/share_handler_tests.rs`

- [ ] **Step 1: 编写 create_share 测试**

- 成功（有/无密码）
- 过期范围无效（0天、31天）
- 文件不存在

- [ ] **Step 2: 编写 list_shares 测试**

- 按状态过滤
- 分页
- 空列表

- [ ] **Step 3: 编写 delete_share / permanent_delete 测试**

- 成功
- 非所有者
- 不存在

- [ ] **Step 4: 编写 get_access_logs / get_user_shares 测试**

- [ ] **Step 5: 编写 public_download 测试**

- 成功下载
- 密码保护（正确/错误/未提供）
- 过期分享
- shareId 格式无效

- [ ] **Step 6: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test share_handler --all-features 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add server-rust/tests/share_handler_tests.rs
git commit -m "test: 添加 share 路由 handler 集成测试"
```

---

## Task 14: Socket 纯逻辑函数提取

**Files:**

- Modify: `src/services/socket.rs`

- [ ] **Step 1: 提取 resolve_user_id 函数**

从 `handle_join_room` 中提取 fingerprint -> user_id 逻辑为独立 `pub fn`。

- [ ] **Step 2: 提取 resolve_username 函数**

从 `handle_join_room` 中提取 username 生成/截断逻辑。

- [ ] **Step 3: 提取 resolve_device_type 函数**

从 `handle_join_room` 中提取 device_type 解析逻辑。

- [ ] **Step 4: 提取 join_room_core 函数**

将 `handle_join_room` 和 `handle_join_room_with_password` 的公共逻辑提取为 `join_room_core`，两个 handler 只负责参数适配和 Socket I/O。

- [ ] **Step 5: 编译检查**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check 2>&1 | head -50`

- [ ] **Step 6: 运行全量测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add server-rust/src/services/socket.rs
git commit -m "refactor: 提取 socket handler 纯逻辑函数，消除 join_room 重复"
```

---

## Task 15: Socket 纯逻辑函数单元测试

**Files:**

- Modify: `src/services/socket.rs` (内联测试)

- [ ] **Step 1: 编写 resolve_user_id 测试**

- 有 fingerprint -> 返回 `fp_{hash}`
- 无 fingerprint -> 返回随机 ID（验证格式）

- [ ] **Step 2: 编写 resolve_username 测试**

- 有 name -> 直接使用
- 无 name -> 生成随机名
- 超长 name -> 截断

- [ ] **Step 3: 编写 resolve_device_type 测试**

- 有 device_type -> 直接使用
- 无 device_type + 有 User-Agent -> 解析
- 无 device_type + 无 User-Agent -> 默认 "desktop"

- [ ] **Step 4: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test socket --all-features 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add server-rust/src/services/socket.rs
git commit -m "test: 添加 socket 纯逻辑函数单元测试"
```

---

## Task 16: Socket `__test_harness` 集成测试

**Files:**

- Modify: `Cargo.toml` (dev-dependencies)
- Create: `tests/common/socket_helpers.rs`
- Create: `tests/socket_integration_tests.rs`

- [ ] **Step 1: 启用 \_\_test_harness feature**

在 `Cargo.toml` 的 `[dev-dependencies]` 中添加：

```toml
socketioxide = { version = "0.15", features = ["state", "__test_harness"] }
```

- [ ] **Step 2: 编写 Socket.IO Packet 编解码辅助**

在 `tests/common/socket_helpers.rs` 中封装 `emit_event` 和 `recv_event` 辅助函数。

- [ ] **Step 3: 编写 joinRoom 集成测试**

- 成功加入
- 密码保护房间

- [ ] **Step 4: 编写 sendMessage 集成测试**

- 文本消息
- 文件消息

- [ ] **Step 5: 编写其他事件集成测试**

- leaveRoom
- disconnect
- setRoomPassword
- recallMessage
- pinRoom

- [ ] **Step 6: 运行测试**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test socket_integration --all-features 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add server-rust/Cargo.toml server-rust/tests/common/socket_helpers.rs server-rust/tests/socket_integration_tests.rs
git commit -m "test: 添加 Socket.IO __test_harness 集成测试"
```

---

## Task 17: 验证与清理

**Files:**

- Various

- [ ] **Step 1: 运行完整覆盖率报告**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm --security-opt seccomp=unconfined -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-coverage cargo tarpaulin --all-features --out Stdout --out Html --output-dir /app/coverage 2>&1 | tail -50`

- [ ] **Step 2: 验证各模块覆盖率达标**

| 模块                       | 目标 |
| -------------------------- | ---- |
| `error.rs`                 | 85%+ |
| `models/message.rs`        | 85%+ |
| `middleware/rate_limit.rs` | 80%+ |
| `routes/rooms.rs`          | 80%+ |
| `routes/files.rs`          | 80%+ |
| `routes/share.rs`          | 80%+ |
| `services/socket.rs`       | 75%+ |

- [ ] **Step 3: 清理旧的无效测试文件**

仅当新增测试达到等效或更优覆盖率时，删除：

- `tests/socket_service_tests.rs`（Mock 重写，与源码无关）
- `tests/rooms_routes_tests.rs`（Mock 重写，与源码无关）
- `tests/share_routes_tests.rs`（Mock 重写，与源码无关）
- `tests/file_routes_tests.rs`（Mock 重写，与源码无关）

- [ ] **Step 4: 运行全量测试确认无回归**

Run: `cd /home/cc/workspace/cloud-clipboard && docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features 2>&1 | tail -30`

- [ ] **Step 5: 更新文档**

更新 CLAUDE.md 中的测试模块列表和覆盖率信息。

- [ ] **Step 6: Commit**

```bash
git add server-rust/
git commit -m "chore: 清理无效测试文件，更新文档"
```
