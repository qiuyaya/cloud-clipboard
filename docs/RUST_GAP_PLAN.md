# Rust 后端功能完整覆盖计划

目标：补齐 Rust 实现与 Node.js 实现的所有功能差距，确保 API/事件行为一致、安全性与运维能力完全对齐。

## 范围与定义

- 覆盖范围：`server-rust` 与 `server` 的服务端功能差异
- 不在范围：前端 UI、构建流程、部署容器优化
- 完成标准：
  - 核心接口与 Socket 事件行为一致（含入参、响应字段、状态码）
  - 清理、限流、安全头、下载安全、静态托管等运维与安全功能对齐
  - 所有对齐回归测试通过

---

## 总体进度：23/23 完成 ✅

| 阶段   | 内容                | 进度            |
| ------ | ------------------- | --------------- |
| 阶段 1 | P0 安全基础（9 项） | 9/9 ✅ 全部完成 |
| 阶段 2 | P1 功能补齐（6 项） | 6/6 ✅ 全部完成 |
| 阶段 3 | P2 安全增强（3 项） | 3/3 ✅ 全部完成 |
| 阶段 4 | P3 体验打磨（5 项） | 5/5 ✅ 全部完成 |

---

## 阶段 1：安全基础（P0）

- [x] **P0.1 消息循环缓冲区（防内存溢出）**
  - 文件：`models/room.rs`
  - 改动：`max_messages=1000`，超出时 `drain(..20%)`，增加 `MessageStats`
  - Node 行为：`RoomModel` 限制 `maxMessages=1000`，超出时删除最旧 20% 消息

- [x] **P0.2 XSS 消息内容过滤**
  - 文件：`utils/sanitize.rs`（新增）, `services/socket.rs`
  - 改动：HTML 实体转义 `<>&"'`，`handle_send_message()` 中调用，含 6 个单元测试
  - Node 行为：`sanitizeMessageContent()` 对文本做 HTML 转义

- [x] **P0.3 Socket 事件级限流**
  - 文件：`services/socket.rs`
  - 改动：`SocketRateLimiter`（per-socket, per-event），7 种事件独立限流，后台 5 分钟清理
  - Node 行为：`SocketService` 每事件类型独立限流（joinRoom 5次/10s, sendMessage 30次/10s 等）

- [x] **P1.7 房间销毁时机对齐**
  - 文件：`services/room_service.rs`
  - 改动：`leave_room()` 和 `set_user_offline()` 中检查房间空/全离线后触发销毁
  - Node 行为：`leaveRoom` 和 `updateUserStatus(isOnline=false)` 调用 `checkRoomDestruction`

- [x] **P0.4 房间销毁事件广播与文件联动清理**
  - 文件：`services/room_service.rs`, `main.rs`
  - 改动：`RoomEvent` broadcast channel，事件监听器联动文件清理和 Socket 广播
  - Node 行为：`RoomService` emit `roomDestroyed` → `fileManager.deleteRoomFiles()` → Socket 广播

- [x] **P0.5 系统消息广播**
  - 文件：`services/socket.rs`, `main.rs`
  - 改动：`SystemMessageEvent` 结构体，`roomDestroyed` 和 `systemMessage` 事件广播
  - Node 行为：`SocketService.sendSystemMessage()` 发送 `file_deleted`/`room_destroyed`/`file_expired`

- [x] **P1.6 清理频率对齐**
  - 文件：`main.rs`
  - 改动：房间清理 3600→60s，文件清理 3600→600s
  - Node 行为：RoomService 每 1 分钟，FileManager 每 10 分钟

- [x] **P0.6 P2P 事件字段名对齐** ✅ 已完成
  - 文件：`services/socket.rs`
  - 严重性：**P2P 传输完全不可用**
  - 问题：P2P 事件字段名与 Node.js 完全不一致

    |        | Node.js 输入 | Rust 输入      | Node.js 输出 | Rust 输出    |
    | ------ | ------------ | -------------- | ------------ | ------------ |
    | 字段名 | `to`         | `targetUserId` | `from`       | `fromUserId` |

  - Node 行为：`SocketService.ts` 中 P2P 事件接收 `{ to, offer/answer/candidate }`，发送 `{ from, offer/answer/candidate }`
  - 改动：
    1. `P2POfferRequest.target_user_id` → 添加 `#[serde(rename = "to")]`
    2. `P2PAnswerRequest.target_user_id` → 添加 `#[serde(rename = "to")]`
    3. `P2PIceCandidateRequest.target_user_id` → 添加 `#[serde(rename = "to")]`
    4. 输出 JSON 中 `"fromUserId"` → `"from"`（`handle_p2p_offer`、`handle_p2p_answer`、`handle_p2p_ice_candidate` 三处）

- [x] **P0.7 shareRoomLink 事件输出对齐** ✅ 已完成
  - 文件：`services/socket.rs`
  - 问题：Rust 返回 `{ roomKey, shareUrl, expiresAt }`，Node.js 返回 `{ roomKey, shareLink }`
  - Node 行为：`SocketService.ts` 从 socket handshake 获取 client origin，生成 `{origin}/?room={roomKey}`，有密码时追加 `&password={password}`，字段名为 `shareLink`
  - 改动：
    1. `RoomLinkGeneratedEvent` 的 `share_url` 改为 `share_link`（序列化为 `shareLink`）
    2. 移除 `expires_at` 字段
    3. URL 生成逻辑对齐：从 socket handshake 或配置获取 client origin，生成 `{origin}/?room={roomKey}`
    4. 如果房间有密码，追加 `&password={password}`

---

## 阶段 2：功能补齐（P1）

- [x] **P1.新 设备类型检测** ✅ 已完成
  - 文件：`utils/device.rs`（新增）, `services/socket.rs`
  - 优先级升级理由：当前 `UserInfo::from()` 在 `socket.rs:29` 硬编码 `device_type: "desktop"`，所有通过 Rust 后端连接的用户均显示为桌面设备，是用户可见的功能退化。建议在 P1.2（指纹重连）之前完成，因为重连流程也需要正确的 device_type。
  - Node 行为：`detectDeviceType(userAgent)` 从 User-Agent 检测设备类型
  - 改动：
    1. 新增 `utils/device.rs`：`detect_device_type(user_agent: &str) -> String`
    2. 从 socketioxide `SocketRef` 获取 User-Agent：使用 `socket.req_parts()` 获取 HTTP request parts
    3. `handle_join_room` 中：优先使用客户端传来的 `user.device_type`，否则从 User-Agent 检测
    4. `UserInfo::from()` 使用 `user.device_type` 字段而非硬编码
    5. `UserResponse::from()`（`rooms.rs:79`）同上，使用实际 device_type

- [x] **P1.1 文件 SHA-256 去重** ✅ 已完成
  - 文件：`services/file_manager.rs`, `routes/files.rs`, `Cargo.toml`
  - Node 行为：`FileManager` 使用 SHA-256 哈希去重，相同文件返回已存在的文件信息
  - 改动：
    1. Cargo.toml 添加 `sha2` crate
    2. `FileInfo` 增加 `hash: Option<String>`
    3. `FileManager` 增加 `hash_to_file_id: RwLock<HashMap<String, String>>`
    4. 新增 `calculate_file_hash(data: &[u8]) -> String`
    5. `save_file()` 先计算哈希，命中则返回已有文件（不写入磁盘）
    6. `delete_file()` 中清理哈希映射
    7. 上传响应中增加 `isDuplicate: bool` 和 `originalFileId: Option<String>` 字段
    8. `delete_room_files()` 也需要清理 `hash_to_file_id` 映射

- [x] **P1.2 设备指纹重连** ✅ 已完成
  - 文件：`services/socket.rs`, `services/room_service.rs`, `routes/rooms.rs`
  - 前置：模型层 fingerprint/device_type 字段已加入，`find_user_by_fingerprint` 已实现；建议 P1.新（设备类型检测）先完成
  - Node 行为：`handleJoinRoom` 通过 fingerprint 查找已存在用户，找到则复用（更新 online 和 socket 映射）
  - 改动：
    1. `handle_join_room()` 有 fingerprint 时先查房间内同 fingerprint 用户
       - 找到 → 设 online=true，更新 socket 映射，走重连流程
       - 未找到 → 走新建用户流程
    2. `handle_join_room_with_password()` 同理
    3. `join_room()` 增加 fingerprint 参数
    4. `routes/rooms.rs` 的 `validate_user` 函数（当前第 318 行有 TODO）需实现基于 fingerprint 的用户查找：调用 `room_service.find_user_by_fingerprint()` 查找用户，找到则返回 `user_exists: true` 及用户信息

- [x] **P1.3 子路径部署 (BASE_PATH)** ✅ 已完成
  - 文件：`main.rs`, `services/socket.rs`
  - Node 行为：`BASE_PATH` 环境变量配置子路径，影响 Socket.IO path 和静态服务
  - 改动：
    1. 读取 `BASE_PATH` 环境变量（默认 `/`）
    2. 使用 Axum `Router::nest(&base_path, api_router)` 实现路由前缀
    3. socketioxide path 配置需预研 `SocketIoBuilder` 是否支持自定义 path

- [x] **P1.4 静态文件服务与 SPA Fallback** ✅ 已完成
  - 文件：`main.rs`
  - 依赖：P1.3 子路径部署
  - Node 行为：生产环境 `express.static` 服务客户端文件，未匹配路由 fallback 到 `index.html`
  - 改动：
    1. 读取 `STATIC_PATH` 环境变量（默认 `./public`）
    2. 使用 `tower_http::services::ServeDir::new(static_path).not_found_service(ServeFile::new(index_path))`
    3. 缓存头配置：静态资源 `max-age=86400`
    4. 确保 API 路由和 Socket.IO 路径优先于静态文件 fallback

- [x] **P1.5 HTTP 安全头与 CORS 完善** ✅ 已完成
  - 文件：`main.rs`
  - Node 行为：Helmet 根据 `ALLOW_HTTP` 条件配置 CSP、HSTS、COOP、COEP
  - 改动：
    1. 读取 `ALLOW_HTTP` 环境变量
    2. HTTPS 模式添加 CSP, HSTS, COOP 头
    3. CORS 生产模式允许同源和无 origin 请求

---

## 阶段 3：安全增强（P2）

- [x] **P2.1 公共下载安全增强** ✅ 已完成（原 P2.1 并发下载流控制 + P2.2 下载带宽追踪 合并）
  - 文件：`routes/share.rs`
  - 合并理由：两者都修改 `public_download` 函数，实现逻辑耦合紧密（同一个请求的安全检查链），合并后避免对同一函数做两次重构
  - Node 行为：`StreamTracker` 限制并发流，`BandwidthTracker` 按 IP 追踪带宽
  - 改动：
    1. `StreamTracker`（AtomicUsize）限制最大并发下载流（环境变量 `MAX_ACTIVE_FILE_STREAMS`，默认 100），超限返回 503
    2. `BandwidthTracker`（per-IP HashMap）追踪下载带宽，超限返回 429
    3. 后台定期清理过期记录
    4. 使用 Drop trait 的 RAII 模式确保计数器递减

- [x] **P2.2 文件类型验证 (Magic Bytes)** ✅ 已完成（原 P2.3）
  - 文件：`routes/share.rs`, `routes/files.rs`, `Cargo.toml`
  - Node 行为：`file-type` 库检查文件魔数确认真实类型
  - 改动：
    1. Cargo.toml 添加 `infer` crate
    2. 下载时检查文件真实类型
    3. 上传时可选验证扩展名与魔数匹配

- [x] **P2.3 TOCTOU 防护与 Symlink 检测** ✅ 已完成（原 P2.4）
  - 文件：`routes/share.rs`, `routes/files.rs`
  - Node 行为：文件描述符级访问防 TOCTOU，检测 symlink/hardlink 攻击
  - 改动：
    1. 下载前用 `fs::symlink_metadata` 检测 symlink
    2. 用文件描述符读取（防 TOCTOU）
    3. 检查 inode link count == 1

---

## 阶段 4：体验打磨（P3）

- [x] **P3.2a 健康检查字段对齐** ✅ 已完成（原 P3.2 拆分）
  - 文件：`routes/health.rs`
  - Node 行为：健康检查返回 `memory` 字段和 `deletedFiles`/`deletedSize` 统计
  - 改动：
    1. 增加 `memory` 字段（使用 `sysinfo` crate 或 `/proc/self/status`）
    2. 增加 `deletedFiles`/`deletedSize` 统计

- [x] **P3.2b 统一错误响应格式** ✅ 已完成（原 P3.2 拆分）
  - 文件：所有 `routes/*.rs`
  - Node 行为：统一 `APIResponse` 格式 `{ success, message, data }` 和错误格式 `{ success, error, message }`
  - 改动：
    1. 定义统一的 `ApiResponse<T>` 和 `ApiErrorResponse` 结构体
    2. 所有路由统一使用该格式

- [x] **P3.2c 分享 API shareUrl 对齐** ✅ 已完成（原 P3.2 拆分）
  - 文件：`routes/share.rs`
  - 依赖：P1.3 BASE_PATH
  - Node 行为：shareUrl 生成包含完整 URL
  - 改动：
    1. shareUrl 生成需包含完整 URL（依赖 BASE_PATH 配置）

- [x] **P3.3 Room 认证中间件抽取** ✅ 已完成
  - 文件：`middleware/auth.rs`（新增）, `middleware/mod.rs`, `routes/rooms.rs`
  - Node 行为：独立的 `authenticateRoom` 和 `optionalRoomAuth` 中间件
  - 改动：
    1. 实现 Axum extractor `AuthenticatedRoom(room_key)`
    2. 替换路由中手动的 x-room-key 检查

- [x] **P3.4 全局错误处理** ✅ 已完成
  - 文件：`main.rs`
  - Node 行为：全局错误处理中间件，统一返回 `{ success: false, message: "..." }`
  - 改动：
    1. 添加 404 fallback handler
    2. 统一错误响应格式

---

## 推荐执行顺序

```
批次 1（P0 bug 修复 + P1 快速修复，可并行）：
  P0.6 P2P 事件字段名修复
  P0.7 shareRoomLink 事件对齐
  P1.新 设备类型检测（原 P3.1，升级为 P1）

批次 2（P1 功能补齐，可并行）：
  P1.1 文件 SHA-256 去重
  P1.2 设备指纹重连 + validate-user 端点
  P1.5 HTTP 安全头与 CORS 完善

批次 3（P1 有依赖的任务）：
  P1.3 子路径部署 (BASE_PATH)
  P1.4 静态文件服务与 SPA Fallback（依赖 P1.3）

批次 4（P2 安全增强，可并行）：
  P2.1 公共下载安全增强（原 P2.1+P2.2 合并）
  P2.2 文件类型验证（原 P2.3）
  P2.3 TOCTOU 防护与 Symlink 检测（原 P2.4）

批次 5（P3 体验打磨，可并行）：
  P3.2a 健康检查字段对齐
  P3.2b 统一错误响应格式
  P3.2c 分享 API shareUrl 对齐（依赖 P1.3）
  P3.3 Room 认证中间件抽取
  P3.4 全局错误处理
```

## 依赖关系

```
P0.6, P0.7 ── 独立，可立即并行
P1.新（设备类型检测） ── 独立，建议在 P1.2 之前
P1.1, P1.5 ── 独立，可并行
P1.2 ── 建议在设备类型检测之后
P1.3 ── P1.4 和 P3.2c 的前置
P2.* ── 互不依赖，可并行
P3.* ── 互不依赖（P3.2c 除外），可并行
```

## 验证方式

- Docker 编译：`docker run --rm -v $(pwd)/server-rust:/app -w /app rust:1.93-alpine sh -c "apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static && cargo check 2>&1"`
- Docker 测试：同上将 `cargo check` 改为 `cargo test`
- 集成验证：启动 Rust 服务器，客户端连接测试所有功能

## 验证清单

### 功能回归测试

| 功能          | 验证项                                                         | 状态 |
| ------------- | -------------------------------------------------------------- | ---- |
| 消息缓冲区    | 超过 1000 条消息后自动裁剪                                     | ⬜   |
| XSS 过滤      | `<script>` 标签被转义                                          | ⬜   |
| Socket 限流   | 超频请求返回 error 事件                                        | ⬜   |
| 房间销毁      | 所有用户离线后房间被销毁、文件被清理、客户端收到 roomDestroyed | ⬜   |
| P2P 传输      | P2P offer/answer/ice 字段名与前端一致，传输正常                | ⬜   |
| 分享链接      | shareRoomLink 返回正确的 shareLink 字段和 URL 格式             | ⬜   |
| 设备检测      | 移动端连接显示正确的设备类型（非硬编码 desktop）               | ⬜   |
| 文件去重      | 相同文件上传两次返回同一 fileId                                | ⬜   |
| 指纹重连      | 断线重连后 userId 不变                                         | ⬜   |
| validate-user | 通过 fingerprint 查询用户返回正确结果                          | ⬜   |
| 子路径        | `BASE_PATH=/app` 下所有功能正常                                | ⬜   |
| 静态服务      | 生产模式下前端页面可正常加载                                   | ⬜   |

### API 对齐验证

| 端点                            | 对比项                    | 状态 |
| ------------------------------- | ------------------------- | ---- |
| `POST /api/rooms/create`        | 请求/响应格式一致         | ⬜   |
| `POST /api/rooms/validate-user` | fingerprint 查询行为一致  | ⬜   |
| `GET /api/health`               | 返回字段一致（含 memory） | ⬜   |
| `POST /api/files/upload`        | 去重行为一致              | ⬜   |
| `GET /public/file/:shareId`     | 安全验证流程一致          | ⬜   |

### Socket 事件验证

| 事件                | 对比项                              | 状态 |
| ------------------- | ----------------------------------- | ---- |
| `joinRoom`          | 指纹重连行为一致                    | ⬜   |
| `sendMessage`       | XSS 过滤生效                        | ⬜   |
| `disconnect`        | 房间销毁联动一致                    | ⬜   |
| `roomDestroyed`     | 事件格式和触发时机一致              | ⬜   |
| `systemMessage`     | 事件类型和数据格式一致              | ⬜   |
| `p2pOffer`          | 输入 `to`/输出 `from` 字段名一致    | ⬜   |
| `p2pAnswer`         | 输入 `to`/输出 `from` 字段名一致    | ⬜   |
| `p2pIceCandidate`   | 输入 `to`/输出 `from` 字段名一致    | ⬜   |
| `roomLinkGenerated` | 返回 `shareLink` 字段、URL 格式一致 | ⬜   |

## 风险与注意事项

1. **内存安全**：Rust 的文件上传目前全量读入内存，需确保 `MAX_FILE_SIZE` 限制严格生效
2. **向后兼容**：事件/字段变更需确保与前端兼容，避免破坏现有客户端
3. **socketioxide 限制**：Rust 的 socketioxide 库与 Node 的 socket.io 在 API 上有差异，部分功能（如从 handshake 获取 headers）需要确认 API 支持
4. **并发安全**：新增的限流器、带宽追踪器等共享状态需要正确使用 RwLock/AtomicUsize，避免死锁
5. **Cargo 依赖**：新增的 crate（sha2, infer）需要审查安全性
6. **socketioxide API 预研**：在实施 P1.2/P1.新（设备类型检测）前，需确认 `SocketRef::req_parts()` 是否可用（获取 User-Agent）
7. **socketioxide path 配置预研**：在实施 P1.3 前，需确认 `SocketIoBuilder` 是否支持自定义 Socket.IO path
