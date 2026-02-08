# Rust 后端功能对齐优化计划

> 基于与 Node.js 后端 (`server/`) 的逐模块对比分析，按优先级分阶段实施。
> 本文档包含足够的代码细节，任何开发者均可据此独立完成修改。

## 参考文件对照表

| 模块 | Node.js 文件 | Rust 文件 |
|------|-------------|-----------|
| 入口 | `server/src/index.ts` | `server-rust/src/main.rs` |
| Socket 服务 | `server/src/services/SocketService.ts` | `server-rust/src/services/socket.rs` |
| 房间服务 | `server/src/services/RoomService.ts` | `server-rust/src/services/room_service.rs` |
| 文件管理 | `server/src/services/FileManager.ts` | `server-rust/src/services/file_manager.rs` |
| 分享服务 | `server/src/services/ShareService.ts` | `server-rust/src/services/share_service.rs` |
| 房间模型 | `server/src/models/Room.ts` | `server-rust/src/models/room.rs` |
| 分享模型 | — | `server-rust/src/models/share.rs` |
| 房间路由 | `server/src/routes/rooms.ts` | `server-rust/src/routes/rooms.rs` |
| 文件路由 | `server/src/routes/files.ts` | `server-rust/src/routes/files.rs` |
| 分享路由 | `server/src/routes/share.ts` | `server-rust/src/routes/share.rs` |
| 认证中间件 | `server/src/middleware/auth.ts` | `server-rust/src/middleware/auth.rs` |
| 限流中间件 | `server/src/middleware/rateLimit.ts` + `rateLimiter.ts` | `server-rust/src/middleware/rate_limit.rs` |
| 验证中间件 | `server/src/middleware/validation.ts` | 无独立文件（内联在各 handler 中） |

---

## 第一阶段：Bug 修复与安全关键问题

### 任务 1.1：修复 ShareService 密码逻辑 bug

**文件**: `src/services/share_service.rs`, `src/routes/share.rs`

**问题**: `create_share()` 方法（第 35-42 行）中，当 `password` 参数为 `None` 时，代码进入 `else` 分支总是自动生成随机密码，导致**无法创建无密码分享**。

**当前代码** (`src/services/share_service.rs:35-42`):
```rust
let (password_hash, generated_password) = if let Some(pwd) = password {
    (Some(bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?), None)
} else {
    // Generate random password if requested
    let pwd = generate_random_password();
    let hash = bcrypt::hash(&pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
    (Some(hash), Some(pwd))
};
```

**Node.js 参考行为** (`server/src/routes/share.ts`): 前端传 `password: "auto-generate"` 时才生成密码，不传则无密码。

**修改方案**:

1. 修改 `CreateShareRequest`（`src/routes/share.rs:123-133`），增加 `enable_password` 字段：
```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareRequest {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub room_key: String,
    pub user_id: String,
    pub expires_in_days: Option<i64>,
    pub password: Option<String>,       // 自定义密码值
    pub enable_password: Option<bool>,   // 新增：是否启用密码
}
```

2. 修改 `create_share()` 的 `password` 参数语义，改为接收 `enable_password: bool` 和 `password: Option<&str>`：
```rust
pub fn create_share(
    &self,
    file_path: String,
    file_name: String,
    file_size: u64,
    room_key: String,
    created_by: String,
    expires_in_days: i64,
    enable_password: bool,         // 新增
    password: Option<&str>,
) -> Result<(ShareInfo, Option<String>), String> {
    let (password_hash, generated_password) = if let Some(pwd) = password {
        // 用户指定了自定义密码
        (Some(bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?), None)
    } else if enable_password {
        // 用户请求自动生成密码
        let pwd = generate_random_password();
        let hash = bcrypt::hash(&pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
        (Some(hash), Some(pwd))
    } else {
        // 无密码
        (None, None)
    };
    // ... 其余不变
}
```

3. 修改 `create_share` handler（`src/routes/share.rs:235-242`）的调用：
```rust
state.share_service.create_share(
    payload.file_path,
    payload.file_name,
    payload.file_size,
    payload.room_key,
    payload.user_id,
    expires_in_days,
    payload.enable_password.unwrap_or(false),  // 新增参数
    payload.password.as_deref(),
)
```

**测试要点**:
- 不传 `password` 和 `enablePassword` → 创建无密码分享
- 传 `enablePassword: true` 不传 `password` → 自动生成密码
- 传 `password: "mypass"` → 使用自定义密码

---

### 任务 1.2：修复 RoomInfo 的 last_activity bug

**文件**: `src/models/room.rs`, `src/routes/rooms.rs`

**问题**: `RoomInfo` 结构体（第 23-30 行）缺少 `last_activity` 字段。`routes/rooms.rs` 中三处（约第 174、220、366 行）将 `last_activity` 赋值为 `info.created_at`，导致该字段始终等于创建时间。

**修改步骤**:

1. 修改 `RoomInfo` 结构体（`src/models/room.rs:23-30`），增加 `last_activity` 字段：
```rust
pub struct RoomInfo {
    pub room_key: String,
    pub user_count: usize,
    pub has_password: bool,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,  // 新增
}
```

2. 修改 `to_info()` 方法（`src/models/room.rs:121-128`）：
```rust
pub fn to_info(&self) -> RoomInfo {
    RoomInfo {
        room_key: self.room_key.clone(),
        user_count: self.user_count(),
        has_password: self.has_password(),
        created_at: self.created_at,
        last_activity: self.last_activity,  // 新增
    }
}
```

3. 修改 `src/routes/rooms.rs` 中所有 `RoomInfoResponse` 构造处（搜索 `last_activity: info.created_at`），改为：
```rust
last_activity: info.last_activity,
```

---

### 任务 1.3：公共下载密码验证改用 Basic Auth

**文件**: `src/routes/share.rs`

**问题**: 当前密码通过 URL query 参数传递（`/public/file/xxx?password=yyy`），密码会暴露在浏览器历史、服务器日志、代理日志中。Node.js 使用 HTTP Basic Auth。

**修改方案** — 修改 `public_download` 函数（第 564-596 行的密码验证部分）：

1. 新增 Basic Auth 解析函数：
```rust
/// 从 Authorization: Basic <base64> 头中提取密码
/// Basic Auth 格式: base64("username:password")，此处 username 可以为空
fn extract_basic_auth_password(headers: &HeaderMap) -> Option<String> {
    let auth_header = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    if !auth_header.starts_with("Basic ") {
        return None;
    }
    let decoded = general_purpose::STANDARD
        .decode(auth_header.trim_start_matches("Basic "))
        .ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    // 格式: "username:password" 或 ":password"
    let password = decoded_str.splitn(2, ':').nth(1)?;
    if password.is_empty() {
        None
    } else {
        Some(password.to_string())
    }
}
```
需要在文件顶部添加 `use base64::{engine::general_purpose, Engine};`，并在 `Cargo.toml` 添加 `base64 = "0.22"` 依赖。

2. 修改密码验证逻辑（替换第 566-596 行）：
```rust
if share.has_password() {
    // 优先使用 Basic Auth，回退到 query 参数
    let password = extract_basic_auth_password(&headers)
        .or(query.password.clone());

    match password {
        Some(pwd) if share.verify_password(&pwd) => {}
        Some(_) => {
            let _ = state.share_service.record_access(
                &share_id, client_ip, false, None,
                Some("Invalid password".to_string()),
            );
            return Err((StatusCode::UNAUTHORIZED, ...));
        }
        None => {
            return Err((StatusCode::UNAUTHORIZED, ...));
        }
    }
}
```

3. 在响应中添加安全头（第 710-717 行，在返回 body 时追加）：
```rust
Ok((
    [
        (header::CONTENT_TYPE, file_info.mime_type),
        (header::CONTENT_DISPOSITION, content_disposition),
        (header::CONTENT_LENGTH, file_info.size.to_string()),
        (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate".to_string()),
        (HeaderName::from_static("x-content-type-options"), "nosniff".to_string()),
    ],
    body,
))
```

**测试要点**:
- Basic Auth 头 `Authorization: Basic base64(":password123")` → 验证成功
- Query 参数 `?password=password123` → 验证成功（兼容）
- 同时提供两者 → Basic Auth 优先
- 无密码 → 401

---

### 任务 1.4：分享撤销添加所有权验证

**文件**: `src/routes/share.rs`

**问题**: `DELETE /api/share/:shareId` handler（第 366-393 行）直接调用 `revoke_share()`，不验证请求者是否为分享创建者。

**修改方案** — 重写 `delete_share` handler：

```rust
async fn delete_share(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    // 获取 user_id
    let user_id = extract_user_id(&headers).ok_or_else(|| (
        StatusCode::UNAUTHORIZED,
        Json(ApiResponse {
            success: false,
            message: Some("User ID required (x-user-id header)".to_string()),
            data: None,
        }),
    ))?;

    // 检查分享是否存在
    let share = state.share_service.get_share(&share_id).ok_or_else(|| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse {
            success: false,
            message: Some("Share not found".to_string()),
            data: None,
        }),
    ))?;

    // 验证所有权
    if share.created_by != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("You do not have permission to revoke this share".to_string()),
                data: None,
            }),
        ));
    }

    // 执行撤销
    match state.share_service.revoke_share(&share_id) {
        Ok(true) => Ok(Json(ApiResponse {
            success: true,
            message: Some("Share revoked".to_string()),
            data: None,
        })),
        Ok(false) => Err((StatusCode::NOT_FOUND, ...)),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, ...)),
    }
}
```

注意：函数签名需要增加 `headers: HeaderMap` 参数。`permanent_delete`（第 396-455 行）已有所有权验证，不需要修改。

---

### 任务 1.5：setRoomPassword 和 shareRoomLink 添加权限检查

**文件**: `src/services/socket.rs`

**问题 1**: `handle_set_room_password`（第 685-705 行）不验证发起者是否为房间成员。
**问题 2**: `handle_share_room_link`（第 707-740 行）同样不验证。

**修改方案** — 在两个函数开头添加权限检查：

```rust
async fn handle_set_room_password(socket: &SocketRef, data: SetRoomPasswordData, room_service: &Arc<RoomService>) {
    let socket_id = socket.id.to_string();

    // 检查用户是否在房间中
    let user = match room_service.get_user_by_socket(&socket_id) {
        Some(u) => u,
        None => {
            let _ = socket.emit("error", &"User not found");
            return;
        }
    };

    // 验证用户所在的房间与目标房间一致
    if let Some(room_key) = room_service.get_room_by_socket(&socket_id) {
        if room_key != data.room_key {
            let _ = socket.emit("error", &"Not a member of this room");
            return;
        }
    } else {
        let _ = socket.emit("error", &"Not in any room");
        return;
    }

    // 空密码时自动生成（对齐 Node.js 行为）
    let password = match &data.password {
        Some(pwd) if pwd.is_empty() => Some(uuid::Uuid::new_v4().to_string()),
        other => other.clone(),
    };

    // ... 继续原有逻辑，将 data.password 替换为 password
}
```

注意：需要在 `RoomService` 中添加 `get_room_by_socket(&self, socket_id: &str) -> Option<String>` 方法（如尚未存在）。

`handle_share_room_link` 同理，在开头添加类似的权限验证。

---

### 任务 1.6：Room Key 格式验证

**文件**: `src/middleware/auth.rs`, `src/routes/rooms.rs`, 新增 `src/utils/validation.rs`

**问题**: auth 中间件（`auth.rs:31-41`）只检查 `!key.is_empty()`，不验证 Room Key 格式���Node.js 使用 Zod schema 验证长度 6-50、字符范围 `[a-zA-Z0-9_-]`、必须同时包含字母和数字。

**修改方案**:

1. 在 `src/utils/` 下新增验证函数（或添加到现有 `mod.rs`）：
```rust
/// 验证 Room Key 格式
/// 规则：长度 6-50，仅允许 [a-zA-Z0-9_-]，必须同时包含字母和数字
pub fn validate_room_key(key: &str) -> Result<(), String> {
    if key.len() < 6 || key.len() > 50 {
        return Err("Room key must be 6-50 characters".to_string());
    }
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Room key can only contain letters, numbers, underscores and hyphens".to_string());
    }
    let has_letter = key.chars().any(|c| c.is_ascii_alphabetic());
    let has_digit = key.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_digit {
        return Err("Room key must contain both letters and numbers".to_string());
    }
    Ok(())
}
```

2. 在 `src/utils/mod.rs` 中导出此函数。

3. 修改 `src/middleware/auth.rs` 的 `FromRequestParts` 实现（第 31-41 行）：
```rust
match room_key {
    Some(key) if !key.is_empty() => {
        if let Err(e) = crate::utils::validate_room_key(&key) {
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse {
                success: false,
                message: Some(e),
                data: None,
            })))
        } else {
            Ok(AuthenticatedRoom(key))
        }
    }
    _ => Err((StatusCode::UNAUTHORIZED, ...))
}
```

4. 修改 `src/routes/rooms.rs` 的 `create_room` handler，替换现有的长度验证（`if payload.room_key.len() < 6 || payload.room_key.len() > 50`）为调用 `validate_room_key()`。

---

## 第二阶段：限流与安全加固

### 任务 2.1：Share 路由添加细粒度限流

**文件**: `src/routes/share.rs`, `src/middleware/rate_limit.rs`, `src/main.rs`

**问题**: share 路由完全没有限流保护，Node.js 有 6 种独立限流器。

**Node.js 限流参数参考** (`server/src/middleware/rateLimiter.ts`):

| 操作 | 窗口 | 最大请求数 |
|------|------|-----------|
| 创建分享 | 1 分钟 | 10 |
| 列表查询 | 1 分钟 | 30 |
| 撤销分享 | 1 分钟 | 20 |
| 访问日志 | 1 分钟 | 50 |
| 公共下载 | 1 分钟 | 20 |

**修改方案**:

1. 在 `src/middleware/rate_limit.rs` 中新增限流器工厂函数：
```rust
pub fn create_share_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    create_rate_limiter(config, config.share_max)  // 默认 10
}
pub fn list_share_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(30).unwrap();
    Arc::new(GovRateLimiter::keyed(Quota::per_minute(nz)))
}
pub fn revoke_share_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(20).unwrap();
    Arc::new(GovRateLimiter::keyed(Quota::per_minute(nz)))
}
pub fn access_logs_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(50).unwrap();
    Arc::new(GovRateLimiter::keyed(Quota::per_minute(nz)))
}
```

2. 将 share router 拆分为独立的子路由组，每组应用不同限流器。在 `src/routes/share.rs` 的 `router()` 函数中：
```rust
pub fn router() -> Router<AppState> {
    // 每个路由组使用独立限流
    let create_routes = Router::new()
        .route("/", post(create_share))
        .layer(RateLimitMiddleware::new(create_share_limiter(&RateLimitConfig::from_env())));

    let list_routes = Router::new()
        .route("/", get(list_shares))
        .layer(RateLimitMiddleware::new(list_share_limiter(&RateLimitConfig::from_env())));

    // ... 合并所有路由
    Router::new()
        .merge(create_routes)
        .merge(list_routes)
        // ...
}
```

或者更简单的方案：在每个 handler 函数内部直接调用限流检查（使用 `LazyLock` 全局限流器），避免复杂的路由嵌套。

---

### 任务 2.2：File 路由添加上传限流

**文件**: `src/routes/files.rs`, `src/middleware/rate_limit.rs`

**问题**: 文件上传无限流保护。Node.js 有 `uploadRateLimit`（1 分钟 / 5 次）。

**修改方案**:

1. 在 `rate_limit.rs` 添加：
```rust
pub fn upload_rate_limiter(_config: &RateLimitConfig) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(5).unwrap();
    Arc::new(GovRateLimiter::keyed(Quota::per_minute(nz)))
}
```

2. 在 `files.rs` 的 `router()` 中，为 upload 路由添加限流 layer，或在 `main.rs` 中为 `/api/files` 路由嵌套限流中间件。

---

### 任务 2.3：Socket.IO 速率限制参数对齐

**文件**: `src/services/socket.rs`

**问题**: `get_rate_limit_config()` 函数（第 215-225 行）的时间窗口和最大请求数与 Node.js 不一致。

**当前 Rust 配置 vs Node.js 对照**:

| 事件 | 当前 Rust (次数/窗口) | Node.js (次数/窗口) | 需改为 |
|------|---------------------|--------------------|----|
| `joinRoom` | 5/10s | 5/60s | 5/60s |
| `joinRoomWithPassword` | 5/10s | 5/60s | 5/60s |
| `leaveRoom` | 10/10s | 10/60s | 10/60s |
| `sendMessage` | 30/10s | 30/60s | 30/60s |
| `requestUserList` | 10/10s | 20/60s | 20/60s |
| `setRoomPassword` | 3/30s | 10/60s | 10/60s |
| `shareRoomLink` | 5/30s | 20/60s | 20/60s |
| 默认 | 30/10s | 30/60s | 30/60s |

**修改方案** — 替换 `get_rate_limit_config()` 内容（`src/services/socket.rs:215-225`）：
```rust
fn get_rate_limit_config(event: &str) -> SocketRateLimitConfig {
    match event {
        "joinRoom" | "joinRoomWithPassword" => SocketRateLimitConfig { max_requests: 5, window_ms: 60_000 },
        "leaveRoom" => SocketRateLimitConfig { max_requests: 10, window_ms: 60_000 },
        "sendMessage" => SocketRateLimitConfig { max_requests: 30, window_ms: 60_000 },
        "requestUserList" => SocketRateLimitConfig { max_requests: 20, window_ms: 60_000 },
        "setRoomPassword" => SocketRateLimitConfig { max_requests: 10, window_ms: 60_000 },
        "shareRoomLink" => SocketRateLimitConfig { max_requests: 20, window_ms: 60_000 },
        _ => SocketRateLimitConfig { max_requests: 30, window_ms: 60_000 },
    }
}
```

---

### 任务 2.4：公共下载安全加固

**文件**: `src/routes/share.rs`

**修改内容**:

**2.4a: 添加 shareId 格式验证**

在 `public_download` 函数开头（第 517 行之前）添加：
```rust
// 验证 shareId 格式 (8-10 位 base62: [a-zA-Z0-9])
if share_id.len() < 8 || share_id.len() > 10
    || !share_id.chars().all(|c| c.is_ascii_alphanumeric())
{
    return Err((StatusCode::BAD_REQUEST, Json(ApiResponse {
        success: false,
        message: Some("Invalid share ID format".to_string()),
        data: None,
    })));
}
```

**2.4b: 统一错误响应（隐藏状态信息）**

将过期和撤销的 `StatusCode::GONE` (410) 改为 `StatusCode::NOT_FOUND` (404)，消息统一为 `"Share not found"`：

第 541-550 行（过期检查）：
```rust
if share.is_expired() {
    return Err((StatusCode::NOT_FOUND, Json(ApiResponse {
        success: false,
        message: Some("Share not found".to_string()),
        data: None,
    })));
}
```

第 552-562 行（活跃检查）：同样改为 404。

**2.4c: 添加硬链接检测**

在符号链接检测之后（第 645 行附近）添加：
```rust
// 检测硬链接攻击
if metadata.nlink() > 1 {
    tracing::warn!("Hard link detected for file: {:?}", file_info.path);
    return Err((StatusCode::FORBIDDEN, Json(ApiResponse {
        success: false,
        message: Some("Access denied".to_string()),
        data: None,
    })));
}
```
注意：需要 `use std::os::unix::fs::MetadataExt;` 来使��� `nlink()` 方法。

---

### 任务 2.5：并发下载限制改为按 IP

**文件**: `src/routes/share.rs`

**问题**: 当前使用全局 `AtomicUsize`（第 22-55 行），所有 IP 共享 100 个并发槽位。Node.js 按 IP 限制每个 IP 最多 5 个并发下载。

**修改方案** — 重写 `StreamGuard`：

```rust
use std::collections::HashMap;
use std::sync::{Mutex, Arc};

static PER_IP_STREAMS: std::sync::LazyLock<Mutex<HashMap<String, usize>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

const MAX_CONCURRENT_PER_IP: usize = 5;
const MAX_CONCURRENT_GLOBAL: usize = 100;

struct StreamGuard {
    ip: String,
}

impl StreamGuard {
    fn acquire(ip: String) -> Result<Self, ()> {
        // 全局限制
        let global = ACTIVE_STREAMS.load(Ordering::Relaxed);
        if global >= MAX_CONCURRENT_GLOBAL {
            return Err(());
        }

        // 按 IP 限制
        let mut map = PER_IP_STREAMS.lock().map_err(|_| ())?;
        let count = map.entry(ip.clone()).or_insert(0);
        if *count >= MAX_CONCURRENT_PER_IP {
            return Err(());
        }
        *count += 1;
        ACTIVE_STREAMS.fetch_add(1, Ordering::AcqRel);
        Ok(StreamGuard { ip })
    }
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        ACTIVE_STREAMS.fetch_sub(1, Ordering::AcqRel);
        if let Ok(mut map) = PER_IP_STREAMS.lock() {
            if let Some(count) = map.get_mut(&self.ip) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(&self.ip);
                }
            }
        }
    }
}
```

调用处（第 518 行）改为：
```rust
let _stream_guard = StreamGuard::acquire(client_ip.clone()).map_err(|_| { ... })?;
```

---

## 第三阶段：API 兼容性对齐

### 任务 3.1：创建房间行为对齐（幂等）

**文件**: `src/services/room_service.rs`

**问题**: Node.js 的 `createRoom()` 在房间已存在时返回现有房间（幂等），Rust 返回 `Err("Room already exists")`。

**修改方案** — 修改 `create_room()` 方法：
```rust
pub fn create_room(&self, room_key: &str, password: Option<&str>) -> Result<RoomInfo, String> {
    let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;
    if let Some(room) = rooms.get(room_key) {
        // 房间已存在，返回现有房间信息（幂等）
        return Ok(room.to_info());
    }
    // ... 创建新房间逻辑不变
}
```

同步修改 `src/routes/rooms.rs` 的 `create_room` handler，移除 409 冲突的错误分支（如果有的话）。

---

### 任务 3.2：创建分享响应字段补全

**文件**: `src/routes/share.rs`

**问题**: `CreateShareResponse`（第 135-142 行）缺少 `fileId`、`createdBy`、`createdAt`、`hasPassword`、`accessCount` 字段。

**修改方案** — 扩展 `CreateShareResponse`：
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareResponse {
    pub share_id: String,
    pub file_id: String,          // 新增：对应 file_path 或 file_name
    pub created_by: String,       // 新增
    pub share_url: String,
    pub password: Option<String>,
    pub created_at: String,       // 新增
    pub expires_at: String,
    pub has_password: bool,       // 新增
    pub access_count: u64,        // 新增（初始为 0）
}
```

修改 handler 中构造 `CreateShareResponse` 的代码，填充新增字段。

---

### 任务 3.3：文件上传响应字段对齐

**文件**: `src/routes/files.rs`

**问题**: 上传响应字段名与 Node.js 的 `FileInfo` 共享类型不匹配。

**Node.js 返回格式**:
```json
{
  "fileId": "xxx",
  "downloadUrl": "http://host/api/files/download/xxx",
  "name": "original.txt",
  "size": 1024,
  "type": "text/plain",
  "lastModified": 1234567890,
  "isDuplicate": false
}
```

**修改方案** — 修改上传响应结构体，使用 `#[serde(rename)]`：
```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub file_id: String,
    pub download_url: String,
    #[serde(rename = "name")]
    pub name: String,                    // 原始文件名
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String,               // MIME 类型
    pub last_modified: Option<u64>,      // 新增：时间戳（毫秒）
    pub is_duplicate: bool,
}
```

---

### 任务 3.4：获取分享详情响应补全

**文件**: `src/models/share.rs`

**问题**: `ShareInfoResponse`（第 35-46 行）缺少 `isExpired`、`lastAccessedAt`、`createdBy`、`status` 字段。

**修改方案** — 扩展 `ShareInfoResponse`：
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfoResponse {
    pub share_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub is_active: bool,
    pub is_expired: bool,                          // 新增
    pub has_password: bool,
    pub access_count: u64,
    pub created_by: String,                        // 新增
    pub last_accessed_at: Option<DateTime<Utc>>,   // 新增
    pub status: String,                            // 新增："active" | "expired"
}
```

修改 `to_response()` 方法（第 106-117 行），填充新增字段：
```rust
pub fn to_response(&self) -> ShareInfoResponse {
    let is_expired = self.is_expired();
    let is_active = self.is_active && !is_expired;
    ShareInfoResponse {
        share_id: self.share_id.clone(),
        file_name: self.file_name.clone(),
        file_size: self.file_size,
        created_at: self.created_at,
        expires_at: self.expires_at,
        is_active,
        is_expired,
        has_password: self.has_password,
        access_count: self.access_count,
        created_by: self.created_by.clone(),
        last_accessed_at: self.access_logs.last().map(|log| log.timestamp),
        status: if is_active { "active".to_string() } else { "expired".to_string() },
    }
}
```

---

### 任务 3.5：下载 URL 返回完整路径

**文件**: `src/routes/files.rs`, `src/routes/share.rs`

**问题**: Rust 返回相对路径（如 `/api/files/download/xxx`），Node.js 返回完整 URL（如 `http://host/api/files/download/xxx`）。

**修改方案** — 添加工具函数从请求头构建 base URL：

```rust
/// 根据请求头构建 base URL
fn build_base_url(headers: &HeaderMap) -> String {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:3001");
    format!("{}://{}", proto, host)
}
```

在构造 `downloadUrl` 和 `shareUrl` 时，拼接 base URL：
```rust
let base_url = build_base_url(&headers);
let download_url = format!("{}/api/files/download/{}", base_url, file_id);
```

注意：需要将 `headers: HeaderMap` 作为参数传入 upload handler。

---

## 第四阶段：功能完善

### 任务 4.1：用户名去重逻辑完善

**文件**: `src/models/room.rs`

**问题**: `generate_unique_username()` 方法（第 140-160 行）与 Node.js 差异较大。

**当前 Rust 行为**: 精确匹配、不排除同指纹用户、只尝试一次、无长度限制。

**Node.js 参考行为** (`server/src/services/SocketService.ts:314-336`):
- 大小写不敏感比较 (`toLowerCase()`)
- ��除相同指纹的用户（同一用户重连不触发去重）
- 最多重试 10 次
- 用户名最长 50 字符，为后缀预留空间（`maxBaseLength = 44`）

**修改方案** — 重写 `generate_unique_username()`:
```rust
pub fn generate_unique_username(&self, username: &str, fingerprint: Option<&str>) -> String {
    let max_length = 50;
    let max_base_length = 44; // 预留 6 字符后缀空间 (_xxxxx)

    // 检查是否有同名用户（大小写不敏感），排除相同指纹的用户
    let name_exists = |name: &str| -> bool {
        self.users.values().any(|u| {
            u.username.to_lowercase() == name.to_lowercase()
                && fingerprint.map_or(true, |fp| {
                    u.fingerprint.as_deref() != Some(fp)
                })
        })
    };

    if !name_exists(username) {
        // 截断到最大长度
        return if username.len() > max_length {
            username[..max_length].to_string()
        } else {
            username.to_string()
        };
    }

    // 有重名，尝试最多 10 次生成唯一名
    let base = if username.len() > max_base_length {
        &username[..max_base_length]
    } else {
        username
    };

    for _ in 0..10 {
        use rand::Rng;
        let suffix: String = rand::rng()
            .sample_iter(&rand::distr::Alphanumeric)
            .take(5)
            .map(|b| (b as char).to_ascii_lowercase())
            .collect();
        let new_name = format!("{}_{}", base, suffix);
        if !name_exists(&new_name) {
            return new_name;
        }
    }

    // 10 次仍失败，使用 UUID 保证唯一
    format!("{}_{}", base, &uuid::Uuid::new_v4().to_string()[..5])
}
```

---

### 任务 4.2：默认用户名使用中文前缀

**文件**: `src/services/socket.rs`

**问题**: 默认用户名格式为 `User_xxxxxx`（英文），Node.js 为 `用户xxxxxx`（中文）。

**修改方案** — 搜索 `format!("User_"` 或类似生成默认用户名的代码（约第 475 行附近），改为：
```rust
let default_username = format!("用户{}", &user_id[5..11]);
```

---

### 任务 4.3：Socket.IO BASE_PATH 适配

**文件**: `src/main.rs`

**问题**: Socket.IO 连接路径不随 `BASE_PATH` 环境变量变化。Node.js 在 `SocketService` 构造函数中设置 `path: basePath === "/" ? "/socket.io" : \`${basePath}/socket.io\``。

**修改方案** — 修改 Socket.IO builder（`src/main.rs:147-149`）：
```rust
let socket_path = if base_path.is_empty() {
    "/socket.io".to_string()
} else {
    format!("{}/socket.io", base_path)
};

let (socket_layer, io) = SocketIo::builder()
    .with_state(app_state.clone())
    // 如果 socketioxide 支持 .path() 配置的话：
    // .path(&socket_path)
    .build_layer();
```

注意：需要查阅 `socketioxide 0.15` 的 API 文档确认是否支持自定义路径。如果不支持，可能需要在 axum 路由层面处理路径重写。

---

### 任务 4.4：访问日志增加 userAgent 字段

**文件**: `src/models/share.rs`, `src/services/share_service.rs`, `src/routes/share.rs`

**修改步骤**:

1. `ShareAccessLog` 增加字段（`src/models/share.rs:5-13`）：
```rust
pub struct ShareAccessLog {
    pub timestamp: DateTime<Utc>,
    pub ip_address: String,
    pub user_agent: Option<String>,  // 新增
    pub success: bool,
    pub bytes_transferred: Option<u64>,
    pub error_message: Option<String>,
}
```

2. `ShareInfo::record_access()` 增加 `user_agent` 参数（`src/models/share.rs:93-104`）。

3. `ShareService::record_access()` 增加 `user_agent` 参数（`src/services/share_service.rs:121-137`）。

4. `public_download` handler 中调用 `record_access` 时传入 User-Agent（`src/routes/share.rs:694`）：
```rust
let user_agent = headers.get(header::USER_AGENT)
    .and_then(|v| v.to_str().ok())
    .map(|s| s.to_string());

let _ = state.share_service.record_access(
    &share_id, client_ip, true, Some(file_info.size), None, user_agent,
);
```

---

### 任务 4.5：FileManager 统计信息补全

**文件**: `src/services/file_manager.rs`

**问题**: `get_stats()` 仅返回 `totalFiles` 和 `totalSize`，缺少 `roomCount`、`deletedFiles`、`deletedSize`。

**修改方案**:

1. 在 `FileManager` 结构体中增加统计字段：
```rust
deleted_file_count: AtomicU64,
total_deleted_size: AtomicU64,
```

2. 在 `delete_file()` 方法中递增这些计数器。

3. 修改 `get_stats()` 返回：
```rust
pub fn get_stats(&self) -> FileStats {
    let files = self.files.read().unwrap_or_else(|_| ...);
    let rooms: std::collections::HashSet<_> = files.values()
        .map(|f| f.room_key.as_str())
        .collect();
    FileStats {
        total_files: files.len(),
        total_size: files.values().map(|f| f.size).sum(),
        room_count: rooms.len(),
        deleted_files: self.deleted_file_count.load(Ordering::Relaxed),
        deleted_size: self.total_deleted_size.load(Ordering::Relaxed),
    }
}
```

---

### 任务 4.6：Socket.IO 连接参数配置

**文件**: `src/main.rs`

**问题**: 未设置 `ping_timeout` 和 `ping_interval`，使用默认值。Node.js 设置为 `pingTimeout: 60000`, `pingInterval: 25000`。

**修改方案** — 修改 Socket.IO builder（`src/main.rs:147-149`）：
```rust
let (socket_layer, io) = SocketIo::builder()
    .with_state(app_state.clone())
    .ping_timeout(std::time::Duration::from_secs(60))
    .ping_interval(std::time::Duration::from_secs(25))
    .build_layer();
```

注意：需确认 `socketioxide 0.15` 是否支持这些配置方法。

---

### 任务 4.7：CORS 开发环境白名单

**文件**: `src/main.rs`

**问题**: Rust 版本无论生产还是开发环境都允许所有来源。Node.js 开发环境仅允许 `CLIENT_URL` 中配置的来源。

**修改方案** — 替换 CORS 构建逻辑（`src/main.rs:204-216`）：
```rust
let cors = if is_production {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any)
        .allow_credentials(false)
} else {
    let allowed_origins: Vec<HeaderValue> = std::env::var("CLIENT_URL")
        .unwrap_or_else(|_| "http://localhost:3000,http://localhost:3002".to_string())
        .split(',')
        .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any)
        .allow_credentials(true)
};
```

---

### 任务 4.8：访问日志清理旧记录

**文件**: `src/services/share_service.rs`

**问题**: `cleanup_expired_shares()` 不清理旧访问日志，Node.js 会清理超过 30 天的记录。

**修改方案** — 在 `cleanup_expired_shares()` 末尾（第 203 行之前）添加：
```rust
// 清理超过 30 天的旧访问日志
let thirty_days_ago = chrono::Utc::now() - chrono::Duration::days(30);
if let Ok(mut shares) = self.shares.write() {
    for share in shares.values_mut() {
        share.access_logs.retain(|log| log.timestamp > thirty_days_ago);
    }
}
```

---

### 任务 4.9：auth 中间件支持多来源获取 Room Key

**文件**: `src/middleware/auth.rs`

**问题**: 只从 `x-room-key` header 获取 Room Key，Node.js 还支持从 body 和 query 获取。

**修改方案** — 这个改动在 axum 的 `FromRequestParts` 中较难实现（因为 body 需要消费），建议保持 header 作为主要来源，仅增加 query 参数支持：

```rust
#[async_trait]
impl<S: Send + Sync> FromRequestParts<S> for AuthenticatedRoom {
    type Rejection = (StatusCode, Json<ApiResponse<()>>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // 优先从 header 获取
        let room_key = parts.headers
            .get("x-room-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // 回退到 query 参数
        let room_key = room_key.or_else(|| {
            let query = parts.uri.query().unwrap_or("");
            url::form_urlencoded::parse(query.as_bytes())
                .find(|(key, _)| key == "roomKey")
                .map(|(_, value)| value.to_string())
        });

        match room_key {
            Some(key) if !key.is_empty() => {
                crate::utils::validate_room_key(&key).map_err(|e| (
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse { success: false, message: Some(e), data: None }),
                ))?;
                Ok(AuthenticatedRoom(key))
            }
            _ => Err((StatusCode::UNAUTHORIZED, ...))
        }
    }
}
```

---

## 第五阶段：测试与验证

### 任务 5.1：为所有修改添加单元测试

每个修改的模块应添加对应测试。重点测试项：

| 模块 | 测试文件 | 关键测试用例 |
|------|---------|------------|
| ShareService 密码 | `src/services/share_service.rs` (#[cfg(test)]) | 无密码分享、自动生成密码、自定义密码三种模式 |
| RoomInfo | `src/models/room.rs` (#[cfg(test)]) | `to_info()` 返回正确的 `last_activity` |
| Room Key 验证 | `src/utils/` 测试模块 | 边界长度(5/6/50/51)、非法字符、缺字母、缺数字 |
| 所有权验证 | `src/routes/share.rs` (#[cfg(test)]) | 非创建者撤销返回 403 |
| 用户名去重 | `src/models/room.rs` (#[cfg(test)]) | 大小写不敏感、指纹排除、重试次数 |
| Basic Auth 解析 | `src/routes/share.rs` (#[cfg(test)]) | 正常解析、空密码、非 Basic 头、malformed base64 |

### 任务 5.2：Docker 编译验证

```bash
# 编译检查（快速验证语法和类型）
docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo check"

# 运行测试
docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine \
  sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo test"

# 完整构建
cd server-rust && docker build -t cloud-clipboard-rust .
```

### 任务 5.3：功能集成测试

手动或自动化验证以下流程：

1. **Socket.IO 流程**: 连接 → joinRoom → sendMessage → leaveRoom → disconnect
2. **文件流程**: upload → download → delete
3. **分享流程**: 创建分享(有密码/无密码) → 公共下载(Basic Auth) → 查看详情 → 撤销 → 永久删除
4. **安全流程**: 非房间成员设置密码 → 被拒绝; 非创建者撤销分享 → 403
5. **限流流程**: 超过限制 → 429 Too Many Requests

---

## 实施注意事项

1. **每个任务完成后运行测试**，确保不引入回归
2. **优先修复 bug 和安全问题**（第一、二阶段），再处理兼容性和功能完善
3. **保持向后兼容**: API 响应增加字段时使用 `#[serde(skip_serializing_if = "Option::is_none")]` 处理可选字段
4. **文档同步**: 每个阶段完成后更新 `server-rust/README.md` 和根目录 `CLAUDE.md`
5. **新增依赖**: 本计划可能需要新增 `base64` crate（用于 Basic Auth 解析），在 `Cargo.toml` 中添加
6. **编译环境**: 本地无 gcc，所有编译必须通过 Docker 进行（参见 `CLAUDE.md` 中的说明）
