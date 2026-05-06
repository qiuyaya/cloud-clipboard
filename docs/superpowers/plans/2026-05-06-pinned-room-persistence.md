# 置顶房间消息持久化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为置顶房间添加 SQLite 持久化存储，使服务重启后能恢复置顶房间的消息和房间设置。

**Architecture:** 新增 PersistenceServiceTrait 和 SqlitePersistenceService，通过 mpsc channel + writer task 解耦同步/异步写入。RoomService 在内存操作后通过 channel 发送持久化命令。启动时在 Socket.IO 初始化前加载置顶房间。

**Tech Stack:** Rust, rusqlite (bundled), tokio::sync::mpsc, serde_json

---

## File Structure

### 新增文件

| 文件                                             | 职责                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `server-rust/src/services/persistence.rs`        | PersistenceServiceTrait 定义、PersistenceCommand 枚举、PersistedRoom 结构体、PersistenceError |
| `server-rust/src/services/persistence/sqlite.rs` | SqlitePersistenceService 实现（含 writer task）                                               |
| `server-rust/src/services/persistence/noop.rs`   | NoOpPersistenceService 实现                                                                   |
| `server-rust/src/services/persistence/mod.rs`    | 模块导出                                                                                      |
| `server-rust/tests/persistence_tests.rs`         | 持久化单元测试和集成测试                                                                      |

### 修改文件

| 文件                                       | 变更                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `server-rust/Cargo.toml`                   | 添加 rusqlite 依赖                                                  |
| `server-rust/src/services/mod.rs`          | 导出 persistence 模块                                               |
| `server-rust/src/services/room_service.rs` | 添加 persistence 字段、with_pinned_rooms 构造、写入后发送持久化命令 |
| `server-rust/src/config.rs`                | 添加 PERSISTENCE_DB_PATH、PERSISTENCE_ENABLED 配置                  |
| `server-rust/src/main.rs`                  | 初始化持久化、加载置顶房间、启动 writer task、graceful shutdown     |
| `server-rust/src/lib.rs`                   | 导出 persistence 模块                                               |
| `server-rust/src/error.rs`                 | 添加 PersistenceError 到 AppError 转换                              |
| `server-rust/Dockerfile`                   | 添加 build-base、创建 data 目录                                     |
| `server-rust/tests/common/mod.rs`          | 添加持久化测试辅助函数                                              |

---

### Task 1: 添加 rusqlite 依赖

**Files:**

- Modify: `server-rust/Cargo.toml`

- [ ] **Step 1: 在 Cargo.toml 的 [dependencies] 中添加 rusqlite**

在 `server-rust/Cargo.toml` 的 `[dependencies]` 部分添加：

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
```

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功（rusqlite bundled 模式需要 C 编译器，如果失败需要先更新 Docker 镜像添加 build-base）

- [ ] **Step 3: 如果编译失败，更新基础镜像**

Run:

```bash
docker build -t cloud-clipboard-rust-base -f- server-rust/ <<'EOF'
FROM rust:1.93-alpine
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static build-base
RUN cargo install cargo-watch
EOF
```

然后重新运行 Step 2 的编译检查。

---

### Task 2: 定义 PersistenceServiceTrait 和相关类型

**Files:**

- Create: `server-rust/src/services/persistence.rs`

- [ ] **Step 1: 创建 persistence.rs，定义 trait、枚举、结构体和错误类型**

```rust
use crate::models::message::Message;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

/// 持久化错误类型
#[derive(Error, Debug)]
pub enum PersistenceError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Channel closed")]
    ChannelClosed,
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Schema version mismatch: expected {expected}, found {found}")]
    SchemaVersion { expected: u32, found: u32 },
}

/// 持久化房间数据（包含重建 Room 对象所需的全部字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// 持久化命令（通过 channel 发送给 writer task）
#[derive(Debug)]
pub enum PersistenceCommand {
    SavePinnedRoom {
        room_key: String,
        data: PersistedRoom,
        messages: Vec<Message>,
    },
    AppendMessage {
        room_key: String,
        message: Message,
    },
    DeleteMessage {
        message_id: String,
    },
    RemovePinnedRoom {
        room_key: String,
    },
    UpdateRoomPassword {
        room_key: String,
        password_hash: Option<String>,
        password: Option<String>,
    },
    Shutdown,
}

/// 持久化服务 trait
#[async_trait]
pub trait PersistenceServiceTrait: Send + Sync {
    /// 初始化数据库（建表、检查 schema 版本、创建目录）
    async fn initialize(&self) -> Result<(), PersistenceError>;

    /// 保存置顶房间完整状态（全量覆盖）
    async fn save_pinned_room(&self, room: &PersistedRoom, messages: &[Message]) -> Result<(), PersistenceError>;

    /// 追加单条消息
    async fn append_message(&self, room_key: &str, message: &Message) -> Result<(), PersistenceError>;

    /// 删除消息（撤回）
    async fn delete_message(&self, message_id: &str) -> Result<(), PersistenceError>;

    /// 加载所有置顶房间（启动时，同步读取）
    async fn load_pinned_rooms(&self) -> Result<Vec<(PersistedRoom, Vec<Message>)>, PersistenceError>;

    /// 取消置顶时删除持久化数据
    async fn remove_pinned_room(&self, room_key: &str) -> Result<(), PersistenceError>;

    /// 更新房间密码
    async fn update_room_password(
        &self,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError>;

    /// 启动 writer task
    async fn start_writer(&self);

    /// 关闭持久化服务
    async fn shutdown(&self) -> Result<(), PersistenceError>;
}
```

- [ ] **Step 2: 创建 persistence 模块目录结构**

创建以下文件：

`server-rust/src/services/persistence/mod.rs`:

```rust
mod sqlite;
mod noop;

pub use persistence::{PersistenceCommand, PersistenceError, PersistenceServiceTrait, PersistedRoom};
pub use sqlite::SqlitePersistenceService;
pub use noop::NoOpPersistenceService;
```

`server-rust/src/services/persistence/noop.rs`:

```rust
use async_trait::async_trait;
use crate::models::message::Message;
use super::persistence::{PersistenceError, PersistenceServiceTrait, PersistedRoom};

/// NoOp 实现（PERSISTENCE_ENABLED=false 时使用）
pub struct NoOpPersistenceService;

#[async_trait]
impl PersistenceServiceTrait for NoOpPersistenceService {
    async fn initialize(&self) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn save_pinned_room(&self, _room: &PersistedRoom, _messages: &[Message]) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn append_message(&self, _room_key: &str, _message: &Message) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn delete_message(&self, _message_id: &str) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn load_pinned_rooms(&self) -> Result<Vec<(PersistedRoom, Vec<Message>)>, PersistenceError> {
        Ok(vec![])
    }

    async fn remove_pinned_room(&self, _room_key: &str) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn update_room_password(
        &self,
        _room_key: &str,
        _password_hash: Option<String>,
        _password: Option<String>,
    ) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn start_writer(&self) {}

    async fn shutdown(&self) -> Result<(), PersistenceError> {
        Ok(())
    }
}
```

- [ ] **Step 3: 在 services/mod.rs 中导出 persistence 模块**

在 `server-rust/src/services/mod.rs` 中添加：

```rust
pub mod persistence;
```

- [ ] **Step 4: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功（noop 实现可能需要调整 import 路径）

---

### Task 3: 实现 SqlitePersistenceService

**Files:**

- Create: `server-rust/src/services/persistence/sqlite.rs`

- [ ] **Step 1: 实现 SqlitePersistenceService 核心结构体和 initialize 方法**

```rust
use async_trait::async_trait;
use crate::config;
use crate::models::message::{Message, MessageSender, FileInfo, MessageType};
use super::persistence::{PersistenceCommand, PersistenceError, PersistenceServiceTrait, PersistedRoom};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const SCHEMA_VERSION: u32 = 1;
const CHANNEL_CAPACITY: usize = 1024;

pub struct SqlitePersistenceService {
    db_path: PathBuf,
    tx: mpsc::Sender<PersistenceCommand>,
    rx: std::sync::Mutex<Option<mpsc::Receiver<PersistenceCommand>>>,
    writer_handle: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl SqlitePersistenceService {
    pub fn new(db_path: &str) -> Self {
        let (tx, rx) = mpsc::channel(CHANNEL_CAPACITY);
        Self {
            db_path: PathBuf::from(db_path),
            tx,
            rx: std::sync::Mutex::new(Some(rx)),
            writer_handle: std::sync::Mutex::new(None),
        }
    }

    fn create_tables(conn: &Connection) -> Result<(), PersistenceError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS pinned_rooms (
                room_key TEXT PRIMARY KEY,
                password_hash TEXT,
                password TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT,
                last_activity TEXT NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0,
                message_dropped_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                room_key TEXT NOT NULL,
                sender_json TEXT NOT NULL,
                message_type TEXT NOT NULL,
                content TEXT,
                timestamp TEXT NOT NULL,
                file_info_json TEXT,
                file_id TEXT,
                FOREIGN KEY (room_key) REFERENCES pinned_rooms(room_key) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_room_key ON messages(room_key);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(room_key, timestamp);",
        )?;
        Ok(())
    }

    fn check_and_set_schema_version(conn: &Connection) -> Result<(), PersistenceError> {
        let version: Option<u32> = conn
            .query_row(
                "SELECT version FROM schema_version LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        match version {
            Some(v) if v == SCHEMA_VERSION => Ok(()),
            Some(v) if v < SCHEMA_VERSION => {
                // 未来版本在此添加迁移逻辑
                // 目前只有版本 1，无需迁移
                conn.execute(
                    "UPDATE schema_version SET version = ?1",
                    params![SCHEMA_VERSION],
                )?;
                Ok(())
            }
            Some(v) => Err(PersistenceError::SchemaVersion {
                expected: SCHEMA_VERSION,
                found: v,
            }),
            None => {
                conn.execute(
                    "INSERT INTO schema_version (version) VALUES (?1)",
                    params![SCHEMA_VERSION],
                )?;
                Ok(())
            }
        }
    }

    fn write_message(conn: &Connection, room_key: &str, msg: &Message) -> Result<(), PersistenceError> {
        let sender_json = serde_json::to_string(&msg.sender)?;
        let file_info_json = msg.file_info.as_ref()
            .map(|fi| serde_json::to_string(fi))
            .transpose()?;
        let file_id = msg.file_info.as_ref().map(|fi| fi.id.clone());

        conn.execute(
            "INSERT OR REPLACE INTO messages (id, room_key, sender_json, message_type, content, timestamp, file_info_json, file_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                msg.id,
                room_key,
                sender_json,
                match msg.message_type {
                    MessageType::Text => "text",
                    MessageType::File => "file",
                    MessageType::System => "system",
                },
                msg.content,
                msg.timestamp.to_rfc3339(),
                file_info_json,
                file_id,
            ],
        )?;
        Ok(())
    }

    fn delete_message(conn: &Connection, message_id: &str) -> Result<(), PersistenceError> {
        conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
        Ok(())
    }

    fn save_pinned_room(conn: &Connection, room: &PersistedRoom, messages: &[Message]) -> Result<(), PersistenceError> {
        let tx = conn.unchecked_transaction()?;

        // 删除旧数据
        tx.execute("DELETE FROM messages WHERE room_key = ?1", params![room.room_key])?;
        tx.execute("DELETE FROM pinned_rooms WHERE room_key = ?1", params![room.room_key])?;

        // 插入房间
        tx.execute(
            "INSERT INTO pinned_rooms (room_key, password_hash, password, created_at, created_by, last_activity, message_count, message_dropped_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                room.room_key,
                room.password_hash,
                room.password,
                room.created_at.to_rfc3339(),
                room.created_by,
                room.last_activity.to_rfc3339(),
                room.message_count as i64,
                room.message_dropped_count as i64,
            ],
        )?;

        // 插入消息
        for msg in messages {
            Self::write_message(&tx, &room.room_key, msg)?;
        }

        tx.commit()?;
        Ok(())
    }

    fn remove_pinned_room(conn: &Connection, room_key: &str) -> Result<(), PersistenceError> {
        // ON DELETE CASCADE 会自动删除关联的 messages
        conn.execute("DELETE FROM pinned_rooms WHERE room_key = ?1", params![room_key])?;
        Ok(())
    }

    fn update_room_password(
        conn: &Connection,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError> {
        conn.execute(
            "UPDATE pinned_rooms SET password_hash = ?1, password = ?2 WHERE room_key = ?3",
            params![password_hash, password, room_key],
        )?;
        Ok(())
    }

    fn load_pinned_rooms(conn: &Connection) -> Result<Vec<(PersistedRoom, Vec<Message>)>, PersistenceError> {
        let mut room_stmt = conn.prepare(
            "SELECT room_key, password_hash, password, created_at, created_by, last_activity, message_count, message_dropped_count
             FROM pinned_rooms"
        )?;

        let rooms: Vec<PersistedRoom> = room_stmt.query_map([], |row| {
            Ok(PersistedRoom {
                room_key: row.get(0)?,
                password_hash: row.get(1)?,
                password: row.get(2)?,
                created_at: row.get::<_, String>(3)?.parse().unwrap(),
                created_by: row.get(4)?,
                last_activity: row.get::<_, String>(5)?.parse().unwrap(),
                is_pinned: true,
                message_count: row.get::<_, i64>(6)? as u64,
                message_dropped_count: row.get::<_, i64>(7)? as u64,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        let mut result = Vec::new();
        for room in rooms {
            let messages = Self::load_messages(conn, &room.room_key)?;
            result.push((room, messages));
        }

        Ok(result)
    }

    fn load_messages(conn: &Connection, room_key: &str) -> Result<Vec<Message>, PersistenceError> {
        let max_messages = config::get_max_messages() as i64;
        let mut stmt = conn.prepare(
            "SELECT id, sender_json, message_type, content, timestamp, file_info_json, file_id
             FROM messages
             WHERE room_key = ?1
             ORDER BY timestamp DESC
             LIMIT ?2"
        )?;

        let messages: Vec<Message> = stmt.query_map(params![room_key, max_messages], |row| {
            let id: String = row.get(0)?;
            let sender_json: String = row.get(1)?;
            let message_type_str: String = row.get(2)?;
            let content: Option<String> = row.get(3)?;
            let timestamp_str: String = row.get(4)?;
            let file_info_json: Option<String> = row.get(5)?;
            let file_id: Option<String> = row.get(6)?;

            // 在 row.query_map 闭包中无法方便地处理错误，
            // 所以先用中间结构收集，外部再转换
            Ok((id, sender_json, message_type_str, content, timestamp_str, file_info_json, file_id))
        })?.filter_map(|r| r.ok()).filter_map(|(id, sender_json, message_type_str, content, timestamp_str, file_info_json, file_id)| {
            // 解析 sender
            let mut sender: MessageSender = match serde_json::from_str(&sender_json) {
                Ok(s) => s,
                Err(_) => return None,
            };
            sender.is_online = false;

            // 解析 message_type
            let message_type = match message_type_str.as_str() {
                "text" => MessageType::Text,
                "file" => MessageType::File,
                "system" => MessageType::System,
                _ => return None,
            };

            // 解析 timestamp
            let timestamp = match timestamp_str.parse::<chrono::DateTime<chrono::Utc>>() {
                Ok(t) => t,
                Err(_) => return None,
            };

            // 解析 file_info 并重新生成 download_url
            let file_info = if let Some(fi_json) = file_info_json {
                let mut fi: FileInfo = match serde_json::from_str(&fi_json) {
                    Ok(f) => f,
                    Err(_) => return None,
                };
                // 根据 PUBLIC_URL 重新生成 download_url
                if let Some(ref fid) = file_id {
                    let public_url = config::get_public_url();
                    fi.download_url = format!("{}/api/files/download/{}", public_url, fid);
                }
                Some(fi)
            } else {
                None
            };

            Some(Message {
                id,
                sender,
                message_type,
                content: content.unwrap_or_default(),
                timestamp,
                file_info,
            })
        }).collect();

        // 反转使消息按时间正序排列（查询用了 DESC）
        let mut messages = messages;
        messages.reverse();

        Ok(messages)
    }

    async fn run_writer(rx: mpsc::Receiver<PersistenceCommand>, db_path: PathBuf) {
        let mut rx = rx;
        let conn = match Connection::open(&db_path) {
            Ok(c) => c,
            Err(e) => {
                tracing::error!("Failed to open SQLite database for writer: {}", e);
                return;
            }
        };

        if let Err(e) = conn.execute("PRAGMA journal_mode=WAL", []) {
            tracing::warn!("Failed to set WAL mode: {}", e);
        }

        while let Some(cmd) = rx.recv().await {
            match cmd {
                PersistenceCommand::Shutdown => {
                    tracing::info!("Persistence writer shutting down");
                    break;
                }
                cmd => {
                    if let Err(e) = Self::handle_command(&conn, cmd) {
                        tracing::warn!("Persistence write failed: {}", e);
                    }
                }
            }
        }
    }

    fn handle_command(conn: &Connection, cmd: PersistenceCommand) -> Result<(), PersistenceError> {
        match cmd {
            PersistenceCommand::SavePinnedRoom { data, messages, .. } => {
                Self::save_pinned_room(conn, &data, &messages)
            }
            PersistenceCommand::AppendMessage { room_key, message } => {
                Self::write_message(conn, &room_key, &message)
            }
            PersistenceCommand::DeleteMessage { message_id } => {
                Self::delete_message(conn, &message_id)
            }
            PersistenceCommand::RemovePinnedRoom { room_key } => {
                Self::remove_pinned_room(conn, &room_key)
            }
            PersistenceCommand::UpdateRoomPassword { room_key, password_hash, password } => {
                Self::update_room_password(conn, &room_key, password_hash, password)
            }
            PersistenceCommand::Shutdown => Ok(()),
        }
    }
}

#[async_trait]
impl PersistenceServiceTrait for SqlitePersistenceService {
    async fn initialize(&self) -> Result<(), PersistenceError> {
        // 创建父目录
        if let Some(parent) = self.db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = Connection::open(&db_path)?;
            Self::create_tables(&conn)?;
            Self::check_and_set_schema_version(&conn)?;
            Ok::<(), PersistenceError>(())
        }).await??;

        Ok(())
    }

    async fn save_pinned_room(&self, room: &PersistedRoom, messages: &[Message]) -> Result<(), PersistenceError> {
        let room = room.clone();
        let messages = messages.to_vec();
        self.tx.try_send(PersistenceCommand::SavePinnedRoom {
            room_key: room.room_key.clone(),
            data: room,
            messages,
        }).map_err(|_| PersistenceError::ChannelClosed)?;
        Ok(())
    }

    async fn append_message(&self, room_key: &str, message: &Message) -> Result<(), PersistenceError> {
        self.tx.try_send(PersistenceCommand::AppendMessage {
            room_key: room_key.to_string(),
            message: message.clone(),
        }).map_err(|_| PersistenceError::ChannelClosed)?;
        Ok(())
    }

    async fn delete_message(&self, message_id: &str) -> Result<(), PersistenceError> {
        self.tx.try_send(PersistenceCommand::DeleteMessage {
            message_id: message_id.to_string(),
        }).map_err(|_| PersistenceError::ChannelClosed)?;
        Ok(())
    }

    async fn load_pinned_rooms(&self) -> Result<Vec<(PersistedRoom, Vec<Message>)>, PersistenceError> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = Connection::open(&db_path)?;
            Self::load_pinned_rooms(&conn)
        }).await?
    }

    async fn remove_pinned_room(&self, room_key: &str) -> Result<(), PersistenceError> {
        self.tx.try_send(PersistenceCommand::RemovePinnedRoom {
            room_key: room_key.to_string(),
        }).map_err(|_| PersistenceError::ChannelClosed)?;
        Ok(())
    }

    async fn update_room_password(
        &self,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError> {
        self.tx.try_send(PersistenceCommand::UpdateRoomPassword {
            room_key: room_key.to_string(),
            password_hash,
            password,
        }).map_err(|_| PersistenceError::ChannelClosed)?;
        Ok(())
    }

    async fn start_writer(&self) {
        let rx = self.rx.lock().unwrap().take();
        if let Some(rx) = rx {
            let db_path = self.db_path.clone();
            let handle = tokio::spawn(Self::run_writer(rx, db_path));
            *self.writer_handle.lock().unwrap() = Some(handle);
        }
    }

    async fn shutdown(&self) -> Result<(), PersistenceError> {
        self.tx.try_send(PersistenceCommand::Shutdown)
            .map_err(|_| PersistenceError::ChannelClosed)?;
        if let Some(handle) = self.writer_handle.lock().unwrap().take() {
            handle.await.map_err(|e| PersistenceError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))?;
        }
        Ok(())
    }
}
```

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功（可能需要根据实际类型定义调整字段名和 import 路径）

---

### Task 4: 添加持久化配置项

**Files:**

- Modify: `server-rust/src/config.rs`

- [ ] **Step 1: 在 config.rs 中添加持久化相关配置**

在 `server-rust/src/config.rs` 中添加两个新函数：

```rust
pub fn get_persistence_db_path() -> String {
    static VALUE: OnceLock<String> = OnceLock::new();
    VALUE.get_or_init(|| {
        env::var("PERSISTENCE_DB_PATH").unwrap_or_else(|_| "data/pinned_rooms.db".to_string())
    }).clone()
}

pub fn is_persistence_enabled() -> bool {
    static VALUE: OnceLock<bool> = OnceLock::new();
    VALUE.get_or_init(|| {
        env::var("PERSISTENCE_ENABLED")
            .unwrap_or_else(|_| "true".to_string())
            .parse()
            .unwrap_or(true)
    }).clone()
}
```

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 5: 集成 PersistenceService 到 RoomService

**Files:**

- Modify: `server-rust/src/services/room_service.rs`

- [ ] **Step 1: 在 RoomService 中添加 persistence 字段**

在 `RoomService` 结构体中添加：

```rust
pub struct RoomService {
    rooms: RwLock<HashMap<String, Room>>,
    persistence: Arc<dyn PersistenceServiceTrait>,
}
```

- [ ] **Step 2: 修改构造函数，添加 with_pinned_rooms**

替换现有 `new()` 方法，并添加 `with_pinned_rooms`：

```rust
impl RoomService {
    pub fn new(persistence: Arc<dyn PersistenceServiceTrait>) -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            persistence,
        }
    }

    pub fn with_pinned_rooms(
        pinned_rooms: Vec<(PersistedRoom, Vec<Message>)>,
        persistence: Arc<dyn PersistenceServiceTrait>,
    ) -> Self {
        let mut rooms = HashMap::new();
        for (persisted, messages) in pinned_rooms {
            let room = Room::from_persisted(persisted, messages);
            rooms.insert(room.key.clone(), room);
        }
        Self {
            rooms: RwLock::new(rooms),
            persistence,
        }
    }
}
```

- [ ] **Step 3: 在 add_message 方法中添加持久化调用**

在 `add_message` 方法中，内存写入成功后、返回之前，添加：

```rust
// 持久化：如果房间置顶，追加消息到 DB
if room.is_pinned {
    if let Err(e) = self.persistence.append_message(&room_key, &message).await {
        tracing::warn!("Failed to persist message: {}", e);
    }
}
```

注意：如果 `add_message` 当前是同步方法（不持有 async），需要将持久化调用改为同步方式。由于 PersistenceServiceTrait 的写入方法是 async 但实际只是 try_send 到 channel，可以创建一个同步包装方法：

在 `PersistenceServiceTrait` 中添加同步发送方法：

```rust
/// 同步发送持久化命令（用于同步上下文）
fn send_command_sync(&self, cmd: PersistenceCommand) -> Result<(), PersistenceError>;
```

在 `SqlitePersistenceService` 中实现：

```rust
fn send_command_sync(&self, cmd: PersistenceCommand) -> Result<(), PersistenceError> {
    self.tx.try_send(cmd).map_err(|_| PersistenceError::ChannelClosed)
}
```

在 `NoOpPersistenceService` 中实现：

```rust
fn send_command_sync(&self, _cmd: PersistenceCommand) -> Result<(), PersistenceError> {
    Ok(())
}
```

然后在 `add_message` 中使用：

```rust
if room.is_pinned {
    if let Err(e) = self.persistence.send_command_sync(PersistenceCommand::AppendMessage {
        room_key: room_key.to_string(),
        message: message.clone(),
    }) {
        tracing::warn!("Failed to persist message: {}", e);
    }
}
```

- [ ] **Step 4: 在 pin_room 方法中添加持久化调用**

在 `pin_room` 方法中，内存更新后添加：

```rust
// 持久化：保存房间完整状态
let (persisted, messages) = {
    let rooms = self.rooms.read().unwrap();
    let room = rooms.get(&room_key).unwrap();
    (PersistedRoom::from_room(room), room.messages.iter().cloned().collect())
};
if let Err(e) = self.persistence.send_command_sync(PersistenceCommand::SavePinnedRoom {
    room_key: room_key.clone(),
    data: persisted,
    messages,
}) {
    tracing::warn!("Failed to persist pinned room: {}", e);
}
```

- [ ] **Step 5: 在 unpin_room 方法中添加持久化调用**

在 `unpin_room` 方法中，内存更新后添加：

```rust
if let Err(e) = self.persistence.send_command_sync(PersistenceCommand::RemovePinnedRoom {
    room_key: room_key.clone(),
}) {
    tracing::warn!("Failed to remove persisted room: {}", e);
}
```

- [ ] **Step 6: 在 remove_message（撤回）方法中添加持久化调用**

在 `remove_message` 方法中，内存删除后添加：

```rust
if room.is_pinned {
    if let Err(e) = self.persistence.send_command_sync(PersistenceCommand::DeleteMessage {
        message_id: message_id.to_string(),
    }) {
        tracing::warn!("Failed to persist message deletion: {}", e);
    }
}
```

- [ ] **Step 7: 在 set_room_password 方法中添加持久化调用**

在密码修改方法中，内存更新后添加：

```rust
if room.is_pinned {
    if let Err(e) = self.persistence.send_command_sync(PersistenceCommand::UpdateRoomPassword {
        room_key: room_key.to_string(),
        password_hash: room.password_hash.clone(),
        password: room.password.clone(),
    }) {
        tracing::warn!("Failed to persist password update: {}", e);
    }
}
```

- [ ] **Step 8: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 6: 在 Room 模型中添加 from_persisted 和 to_persisted 转换方法

**Files:**

- Modify: `server-rust/src/models/room.rs`

- [ ] **Step 1: 在 Room 结构体中添加 from_persisted 和转换方法**

```rust
impl Room {
    /// 从持久化数据重建 Room 对象
    pub fn from_persisted(persisted: PersistedRoom, messages: Vec<Message>) -> Self {
        Self {
            key: persisted.room_key,
            password_hash: persisted.password_hash,
            password: persisted.password,
            created_at: persisted.created_at,
            created_by: persisted.created_by,
            users: HashMap::new(), // 恢复后用户列表为空
            messages: messages.into(),
            is_pinned: persisted.is_pinned,
            last_activity: persisted.last_activity,
            message_count: persisted.message_count,
            message_dropped_count: persisted.message_dropped_count,
        }
    }
}

impl PersistedRoom {
    /// 从 Room 对象创建 PersistedRoom
    pub fn from_room(room: &Room) -> Self {
        Self {
            room_key: room.key.clone(),
            password_hash: room.password_hash.clone(),
            password: room.password.clone(),
            created_at: room.created_at,
            created_by: room.created_by.clone(),
            last_activity: room.last_activity,
            is_pinned: room.is_pinned,
            message_count: room.message_count,
            message_dropped_count: room.message_dropped_count,
        }
    }
}
```

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 7: 修改 main.rs 集成持久化启动流程

**Files:**

- Modify: `server-rust/src/main.rs`

- [ ] **Step 1: 在 main.rs 中添加持久化初始化流程**

在 `main()` 函数中，在创建 RoomService 之前添加持久化初始化：

```rust
// 初始化持久化服务
let persistence: Arc<dyn PersistenceServiceTrait> = if config::is_persistence_enabled() {
    let db_path = config::get_persistence_db_path();
    let svc = SqlitePersistenceService::new(&db_path);
    svc.initialize().await?;
    let pinned_rooms = svc.load_pinned_rooms().await?;
    tracing::info!("Loaded {} pinned rooms from persistence", pinned_rooms.len());
    svc.start_writer().await;
    Arc::new(svc)
} else {
    Arc::new(NoOpPersistenceService)
};

// 创建 RoomService
let room_service = Arc::new(RoomService::with_pinned_rooms(pinned_rooms, persistence.clone()));
```

注意：需要根据 main.rs 的实际结构调整，确保在 Socket.IO 初始化之前完成。

- [ ] **Step 2: 添加 graceful shutdown 处理**

在 shutdown signal handler 中添加持久化关闭：

```rust
// 在 shutdown handler 中
persistence.shutdown().await.ok();
```

- [ ] **Step 3: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 8: 更新 lib.rs 导出

**Files:**

- Modify: `server-rust/src/lib.rs`

- [ ] **Step 1: 在 lib.rs 中添加 persistence 模块导出**

确保 `persistence` 模块及其公共类型在 `lib.rs` 中导出，供测试使用：

```rust
pub mod services::persistence;
```

或者根据现有导出模式添加相应的 re-export。

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 9: 更新 Dockerfile

**Files:**

- Modify: `server-rust/Dockerfile`

- [ ] **Step 1: 在 Dockerfile 中添加 build-base 和 data 目录**

在构建阶段的 `apk add` 行中添加 `build-base`：

```dockerfile
RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static build-base
```

在运行阶段创建 data 目录：

```dockerfile
RUN mkdir -p /app/data
```

- [ ] **Step 2: 验证 Docker 构建**

Run: `cd server-rust && docker build -t cloud-clipboard-rust .`
Expected: 构建成功

---

### Task 10: 编写持久化单元测试

**Files:**

- Create: `server-rust/tests/persistence_tests.rs`
- Modify: `server-rust/tests/common/mod.rs`

- [ ] **Step 1: 在 common/mod.rs 中添加持久化测试辅助函数**

```rust
use crate::services::persistence::{PersistenceServiceTrait, PersistedRoom, SqlitePersistenceService};

pub fn create_test_persistence_service() -> Arc<dyn PersistenceServiceTrait> {
    // 使用内存数据库
    Arc::new(SqlitePersistenceService::new(":memory:"))
}

pub fn create_test_persisted_room(room_key: &str) -> PersistedRoom {
    PersistedRoom {
        room_key: room_key.to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: Some("test_user".to_string()),
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    }
}
```

- [ ] **Step 2: 编写 persistence_tests.rs**

```rust
mod common;

use cloud_clipboard::services::persistence::*;
use cloud_clipboard::models::message::*;

#[tokio::test]
async fn test_initialize_creates_tables() {
    let svc = SqlitePersistenceService::new(":memory:");
    assert!(svc.initialize().await.is_ok());
}

#[tokio::test]
async fn test_save_and_load_pinned_room() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: Some("hash123".to_string()),
        password: Some("pass123".to_string()),
        created_at: chrono::Utc::now(),
        created_by: Some("creator".to_string()),
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 5,
        message_dropped_count: 0,
    };

    svc.save_pinned_room(&room, &[]).await.unwrap();

    // 等待 writer task 处理
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].0.room_key, "test_room");
    assert_eq!(loaded[0].0.password_hash, Some("hash123".to_string()));
    assert_eq!(loaded[0].0.password, Some("pass123".to_string()));
    assert_eq!(loaded[0].0.message_count, 5);

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_append_message() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    // 先保存房间
    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };
    svc.save_pinned_room(&room, &[]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // 追加消息
    let message = Message {
        id: "msg_1".to_string(),
        sender: MessageSender {
            id: "user_1".to_string(),
            name: "TestUser".to_string(),
            is_online: true,
            last_seen: chrono::Utc::now(),
            device_type: "desktop".to_string(),
            fingerprint: None,
        },
        message_type: MessageType::Text,
        content: "Hello world".to_string(),
        timestamp: chrono::Utc::now(),
        file_info: None,
    };

    svc.append_message("test_room", &message).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded[0].1.len(), 1);
    assert_eq!(loaded[0].1[0].content, "Hello world");
    assert!(!loaded[0].1[0].sender.is_online); // 恢复后 is_online 应为 false

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_delete_message() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };

    let message = Message {
        id: "msg_1".to_string(),
        sender: MessageSender {
            id: "user_1".to_string(),
            name: "TestUser".to_string(),
            is_online: true,
            last_seen: chrono::Utc::now(),
            device_type: "desktop".to_string(),
            fingerprint: None,
        },
        message_type: MessageType::Text,
        content: "Hello".to_string(),
        timestamp: chrono::Utc::now(),
        file_info: None,
    };

    svc.save_pinned_room(&room, &[message.clone()]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    svc.delete_message("msg_1").await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded[0].1.len(), 0);

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_remove_pinned_room() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };

    svc.save_pinned_room(&room, &[]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    svc.remove_pinned_room("test_room").await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded.len(), 0);

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_update_room_password() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };

    svc.save_pinned_room(&room, &[]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    svc.update_room_password("test_room", Some("new_hash".to_string()), Some("new_pass".to_string())).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded[0].0.password_hash, Some("new_hash".to_string()));
    assert_eq!(loaded[0].0.password, Some("new_pass".to_string()));

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_save_pinned_room_full_overwrite() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test_room".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };

    let msg1 = Message {
        id: "msg_1".to_string(),
        sender: MessageSender {
            id: "user_1".to_string(),
            name: "User1".to_string(),
            is_online: true,
            last_seen: chrono::Utc::now(),
            device_type: "desktop".to_string(),
            fingerprint: None,
        },
        message_type: MessageType::Text,
        content: "First".to_string(),
        timestamp: chrono::Utc::now(),
        file_info: None,
    };

    svc.save_pinned_room(&room, &[msg1]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // 全量覆盖：新消息列表为空
    let updated_room = PersistedRoom {
        message_count: 10,
        ..room.clone()
    };
    svc.save_pinned_room(&updated_room, &[]).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let loaded = svc.load_pinned_rooms().await.unwrap();
    assert_eq!(loaded[0].1.len(), 0); // 消息被全量覆盖清除
    assert_eq!(loaded[0].0.message_count, 10);

    svc.shutdown().await.unwrap();
}

#[tokio::test]
async fn test_noop_persistence_service() {
    let svc = NoOpPersistenceService;
    svc.initialize().await.unwrap();
    svc.start_writer().await;

    let room = PersistedRoom {
        room_key: "test".to_string(),
        password_hash: None,
        password: None,
        created_at: chrono::Utc::now(),
        created_by: None,
        last_activity: chrono::Utc::now(),
        is_pinned: true,
        message_count: 0,
        message_dropped_count: 0,
    };

    assert!(svc.save_pinned_room(&room, &[]).await.is_ok());
    assert!(svc.load_pinned_rooms().await.unwrap().is_empty());
    assert!(svc.shutdown().await.is_ok());
}

#[tokio::test]
async fn test_schema_version_check() {
    let svc = SqlitePersistenceService::new(":memory:");
    svc.initialize().await.unwrap();

    // 重复初始化应该成功（版本一致）
    assert!(svc.initialize().await.is_ok());
}
```

- [ ] **Step 3: 运行测试**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --test persistence_tests`
Expected: 所有测试通过

---

### Task 11: 更新现有测试以适配 PersistenceService 依赖

**Files:**

- Modify: `server-rust/tests/common/mod.rs`
- Modify: 所有使用 RoomService 的测试文件

- [ ] **Step 1: 在 common/mod.rs 中更新 RoomService 创建方式**

所有创建 RoomService 的地方需要传入 PersistenceService 参数。使用 NoOpPersistenceService 以保持现有测试行为不变：

```rust
pub fn create_test_room_service() -> Arc<RoomService> {
    let persistence: Arc<dyn PersistenceServiceTrait> = Arc::new(NoOpPersistenceService);
    Arc::new(RoomService::new(persistence))
}
```

- [ ] **Step 2: 更新所有测试文件中的 RoomService 创建**

搜索所有 `RoomService::new()` 调用，替换为 `RoomService::new(Arc::new(NoOpPersistenceService))` 或使用 `create_test_room_service()` 辅助函数。

- [ ] **Step 3: 运行全部测试**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features`
Expected: 所有测试通过

---

### Task 12: 更新 AppState 和依赖注入

**Files:**

- Modify: `server-rust/src/app.rs` 或定义 AppState 的文件

- [ ] **Step 1: 确认 AppState 是否需要变更**

检查 AppState 结构体是否需要添加 persistence 字段。如果 AppState 只包含 room_service 等，且 room_service 内部持有 persistence，则无需修改 AppState。

- [ ] **Step 2: 如需要，更新 AppState**

如果其他 handler 需要直接访问 persistence（如管理 API），则添加字段：

```rust
pub struct AppState {
    pub room_service: Arc<dyn RoomServiceTrait>,
    pub file_manager: Arc<dyn FileManagerTrait>,
    pub share_service: Arc<dyn ShareServiceTrait>,
    pub persistence: Arc<dyn PersistenceServiceTrait>,  // 新增
}
```

- [ ] **Step 3: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 13: 文件消息恢复验证

**Files:**

- Modify: `server-rust/src/services/persistence/sqlite.rs`

- [ ] **Step 1: 在 load_messages 中添加文件存在性检查**

在 `load_messages` 方法中，对文件类型消息添加文件存在性验证：

```rust
// 在 file_info 处理部分
let file_info = if let Some(fi_json) = file_info_json {
    let mut fi: FileInfo = match serde_json::from_str(&fi_json) {
        Ok(f) => f,
        Err(_) => return None,
    };

    // 重新生成 download_url
    if let Some(ref fid) = file_id {
        let public_url = config::get_public_url();
        fi.download_url = format!("{}/api/files/download/{}", public_url, fid);
    }

    // 检查文件是否存在
    let upload_dir = config::get_upload_dir();
    let file_path = std::path::Path::new(&upload_dir).join(fid.unwrap_or_default());
    if !file_path.exists() {
        // 文件不存在，转为系统消息
        // 返回一个特殊的 Message，标记文件已失效
        // 这里通过返回 None 并在后续处理中添加系统消息
        // 或者直接修改 message_type 和 content
        // 简单方案：保留消息但修改类型和内容
        tracing::warn!("File not found for message {}, file_id: {:?}", id, file_id);
        // 返回系统消息替代
        return Some(Message {
            id: id.clone(),
            sender: MessageSender {
                id: "system".to_string(),
                name: "System".to_string(),
                is_online: false,
                last_seen: chrono::Utc::now(),
                device_type: "system".to_string(),
                fingerprint: None,
            },
            message_type: MessageType::System,
            content: "文件已失效".to_string(),
            timestamp,
            file_info: None,
        });
    }

    Some(fi)
} else {
    None
};
```

- [ ] **Step 2: 验证编译**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo check`
Expected: 编译成功

---

### Task 14: 运行完整测试套件

**Files:**

- None

- [ ] **Step 1: 运行所有 Rust 测试**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base cargo test --all-features`
Expected: 所有测试通过

- [ ] **Step 2: 运行 Rust 代码格式化检查**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base sh -c "rustup component add rustfmt && cargo fmt -- --check"`
Expected: 格式检查通过

- [ ] **Step 3: 运行 Clippy 检查**

Run: `docker run --rm -v cargo-registry:/usr/local/cargo/registry -v $(pwd)/server-rust:/app -w /app cloud-clipboard-rust-base sh -c "rustup component add clippy && cargo clippy --all-targets --all-features -- -D warnings"`
Expected: 无 Clippy 警告

---

### Task 15: 更新文档

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: 更新 CLAUDE.md**

在环境变量部分添加：

- `PERSISTENCE_DB_PATH` - SQLite 数据库路径，默认 `data/pinned_rooms.db`
- `PERSISTENCE_ENABLED` - 是否启用持久化，默认 `true`

在架构说明中添加持久化相关描述。

在 Recent Changes 中添加本次变更记录。

- [ ] **Step 2: 更新 README.md**

在功能特性列表中添加"置顶房间消息持久化"。

在环境变量部分添加新配置项。

在 Docker 部署说明中添加 volume 挂载指引。

---

## Self-Review Checklist

- [x] Spec coverage: 每个设计需求都有对应 Task
  - SQLite 持久化: Task 1-3
  - Channel 解耦: Task 3
  - 配置项: Task 4
  - RoomService 集成: Task 5
  - Room 模型转换: Task 6
  - 启动流程: Task 7
  - Docker 调整: Task 9
  - 文件恢复: Task 13
  - 测试: Task 10-11, 14
  - 文档: Task 15
- [x] Placeholder scan: 无 TBD/TODO
- [x] Type consistency: PersistedRoom、PersistenceCommand、Message 等类型在各 Task 中一致
