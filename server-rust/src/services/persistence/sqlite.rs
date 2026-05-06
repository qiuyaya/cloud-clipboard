use super::{PersistedRoom, PersistenceCommand, PersistenceError, PersistenceServiceTrait};
use crate::models::{FileInfo, Message, MessageSender, MessageType};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

const SCHEMA_VERSION: i32 = 1;
const CHANNEL_CAPACITY: usize = 1024;

/// SQLite-based persistence service for pinned rooms
pub struct SqlitePersistenceService {
    db_path: PathBuf,
    sender: mpsc::Sender<PersistenceCommand>,
    max_messages: usize,
}

impl SqlitePersistenceService {
    pub fn new(db_path: PathBuf, max_messages: usize) -> Self {
        let (sender, _receiver) = mpsc::channel(CHANNEL_CAPACITY);
        Self {
            db_path,
            sender,
            max_messages,
        }
    }

    /// Create database schema
    fn create_schema(conn: &Connection) -> Result<(), PersistenceError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS pinned_rooms (
                room_key TEXT PRIMARY KEY,
                password_hash TEXT,
                password TEXT,
                is_pinned INTEGER NOT NULL DEFAULT 1,
                created_by TEXT,
                created_at TEXT NOT NULL,
                last_activity TEXT NOT NULL,
                max_messages INTEGER NOT NULL DEFAULT 1000,
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
                seq INTEGER NOT NULL,
                FOREIGN KEY (room_key) REFERENCES pinned_rooms(room_key) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_room_key ON messages(room_key);
            CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_key, seq);",
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Set schema version
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            [SCHEMA_VERSION],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Check and handle schema version
    fn check_schema_version(conn: &Connection) -> Result<(), PersistenceError> {
        let version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if version != SCHEMA_VERSION {
            warn!(
                "Schema version mismatch: expected {}, found {}. Recreating schema.",
                SCHEMA_VERSION, version
            );
        }

        Ok(())
    }

    /// Open a database connection and ensure schema exists
    fn open_connection(db_path: &PathBuf) -> Result<Connection, PersistenceError> {
        // Create parent directory if needed
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn =
            Connection::open(db_path).map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Self::create_schema(&conn)?;
        Self::check_schema_version(&conn)?;

        Ok(conn)
    }

    /// Execute save_pinned_room synchronously
    fn do_save_pinned_room(
        conn: &Connection,
        room: &PersistedRoom,
        messages: &[Message],
    ) -> Result<(), PersistenceError> {
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Delete existing room data (CASCADE will delete messages)
        tx.execute(
            "DELETE FROM pinned_rooms WHERE room_key = ?1",
            [&room.room_key],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Insert room
        tx.execute(
            "INSERT INTO pinned_rooms (room_key, password_hash, password, is_pinned, created_by, created_at, last_activity, max_messages, message_count, message_dropped_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                room.room_key,
                room.password_hash,
                room.password,
                room.is_pinned as i32,
                room.created_by,
                room.created_at.to_rfc3339(),
                room.last_activity.to_rfc3339(),
                room.max_messages as i64,
                room.message_count as i64,
                room.message_dropped_count as i64,
            ],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Insert messages
        for (seq, msg) in messages.iter().enumerate() {
            Self::insert_message(&tx, &room.room_key, msg, seq as i64)?;
        }

        tx.commit()
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Insert a single message into the database
    fn insert_message(
        conn: &Connection,
        room_key: &str,
        msg: &Message,
        seq: i64,
    ) -> Result<(), PersistenceError> {
        let sender_json = serde_json::to_string(&msg.sender)
            .map_err(|e| PersistenceError::Serialization(e.to_string()))?;

        let file_info_json = msg
            .file_info
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| PersistenceError::Serialization(e.to_string()))?;

        let message_type_str = match msg.message_type {
            MessageType::Text => "text",
            MessageType::File => "file",
            MessageType::System => "system",
        };

        conn.execute(
            "INSERT OR REPLACE INTO messages (id, room_key, sender_json, message_type, content, timestamp, file_info_json, file_id, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                msg.id,
                room_key,
                sender_json,
                message_type_str,
                msg.content,
                msg.timestamp.to_rfc3339(),
                file_info_json,
                msg.file_id,
                seq,
            ],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Execute append_message synchronously
    fn do_append_message(
        conn: &Connection,
        room_key: &str,
        message: &Message,
    ) -> Result<(), PersistenceError> {
        // Get the next sequence number for this room
        let max_seq: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(seq), -1) FROM messages WHERE room_key = ?1",
                [room_key],
                |row| row.get(0),
            )
            .unwrap_or(-1);

        let next_seq = max_seq + 1;
        Self::insert_message(conn, room_key, message, next_seq)?;

        Ok(())
    }

    /// Execute delete_message synchronously
    fn do_delete_message(
        conn: &Connection,
        room_key: &str,
        message_id: &str,
    ) -> Result<(), PersistenceError> {
        conn.execute(
            "DELETE FROM messages WHERE room_key = ?1 AND id = ?2",
            rusqlite::params![room_key, message_id],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Execute load_pinned_rooms synchronously
    fn do_load_pinned_rooms(
        conn: &Connection,
        max_messages: usize,
    ) -> Result<HashMap<String, (PersistedRoom, Vec<Message>)>, PersistenceError> {
        let mut result = HashMap::new();

        // Load all pinned rooms
        let mut room_stmt = conn
            .prepare(
                "SELECT room_key, password_hash, password, is_pinned, created_by, created_at, last_activity, max_messages, message_count, message_dropped_count
                 FROM pinned_rooms WHERE is_pinned = 1",
            )
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        let room_rows = room_stmt
            .query_map([], |row| {
                let room_key: String = row.get(0)?;
                let password_hash: Option<String> = row.get(1)?;
                let password: Option<String> = row.get(2)?;
                let is_pinned: i32 = row.get(3)?;
                let created_by: Option<String> = row.get(4)?;
                let created_at_str: String = row.get(5)?;
                let last_activity_str: String = row.get(6)?;
                let max_messages: i64 = row.get(7)?;
                let message_count: i64 = row.get(8)?;
                let message_dropped_count: i64 = row.get(9)?;

                Ok((
                    room_key,
                    password_hash,
                    password,
                    is_pinned,
                    created_by,
                    created_at_str,
                    last_activity_str,
                    max_messages,
                    message_count,
                    message_dropped_count,
                ))
            })
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        let rooms: Vec<_> = room_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        for (
            room_key,
            password_hash,
            password,
            is_pinned,
            created_by,
            created_at_str,
            last_activity_str,
            room_max_messages,
            message_count,
            message_dropped_count,
        ) in rooms
        {
            let created_at: DateTime<Utc> = DateTime::parse_from_rfc3339(&created_at_str)
                .map_err(|e| PersistenceError::Serialization(e.to_string()))?
                .to_utc();
            let last_activity: DateTime<Utc> = DateTime::parse_from_rfc3339(&last_activity_str)
                .map_err(|e| PersistenceError::Serialization(e.to_string()))?
                .to_utc();

            let persisted = PersistedRoom {
                room_key: room_key.clone(),
                password_hash,
                password,
                is_pinned: is_pinned != 0,
                created_by,
                created_at,
                last_activity,
                max_messages: room_max_messages as usize,
                message_count: message_count as u64,
                message_dropped_count: message_dropped_count as u64,
            };

            // Load messages for this room, only the most recent max_messages
            let effective_max = if room_max_messages as usize > 0 {
                std::cmp::min(room_max_messages as usize, max_messages)
            } else {
                max_messages
            };

            let messages = Self::load_room_messages(conn, &room_key, effective_max)?;
            result.insert(room_key, (persisted, messages));
        }

        Ok(result)
    }

    /// Load messages for a specific room, limited to the most recent N messages
    fn load_room_messages(
        conn: &Connection,
        room_key: &str,
        limit: usize,
    ) -> Result<Vec<Message>, PersistenceError> {
        let mut stmt = conn
            .prepare(
                "SELECT id, room_key, sender_json, message_type, content, timestamp, file_info_json, file_id
                 FROM messages WHERE room_key = ?1 ORDER BY seq ASC",
            )
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        let rows = stmt
            .query_map([room_key], |row| {
                let id: String = row.get(0)?;
                let room_key: String = row.get(1)?;
                let sender_json: String = row.get(2)?;
                let message_type_str: String = row.get(3)?;
                let content: Option<String> = row.get(4)?;
                let timestamp_str: String = row.get(5)?;
                let file_info_json: Option<String> = row.get(6)?;
                let file_id: Option<String> = row.get(7)?;

                Ok((
                    id,
                    room_key,
                    sender_json,
                    message_type_str,
                    content,
                    timestamp_str,
                    file_info_json,
                    file_id,
                ))
            })
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        let all_messages: Vec<_> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        // Only take the most recent `limit` messages
        let start = if all_messages.len() > limit {
            all_messages.len() - limit
        } else {
            0
        };

        let messages: Vec<Message> = all_messages[start..]
            .iter()
            .filter_map(
                |(
                    id,
                    rk,
                    sender_json,
                    message_type_str,
                    content,
                    timestamp_str,
                    file_info_json,
                    file_id,
                )| {
                    Self::parse_message(
                        id,
                        rk,
                        sender_json,
                        message_type_str,
                        content,
                        timestamp_str,
                        file_info_json,
                        file_id,
                    )
                    .transpose()
                },
            )
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e: PersistenceError| e)?;

        Ok(messages)
    }

    /// Parse a single message from database row data
    #[allow(clippy::too_many_arguments)]
    fn parse_message(
        id: &str,
        room_key: &str,
        sender_json: &str,
        message_type_str: &str,
        content: &Option<String>,
        timestamp_str: &str,
        file_info_json: &Option<String>,
        file_id: &Option<String>,
    ) -> Result<Option<Message>, PersistenceError> {
        let sender: MessageSender = match serde_json::from_str(sender_json) {
            Ok(s) => s,
            Err(e) => {
                warn!("Failed to parse sender JSON for message {}: {}", id, e);
                return Ok(None);
            }
        };

        let message_type = match message_type_str {
            "text" => MessageType::Text,
            "file" => MessageType::File,
            "system" => MessageType::System,
            _ => {
                warn!(
                    "Unknown message type '{}' for message {}",
                    message_type_str, id
                );
                return Ok(None);
            }
        };

        let timestamp: DateTime<Utc> = match DateTime::parse_from_rfc3339(timestamp_str) {
            Ok(dt) => dt.to_utc(),
            Err(e) => {
                warn!("Failed to parse timestamp for message {}: {}", id, e);
                return Ok(None);
            }
        };

        let file_info: Option<FileInfo> = file_info_json
            .as_ref()
            .map(|json| serde_json::from_str(json))
            .transpose()
            .map_err(|e| PersistenceError::Serialization(e.to_string()))?;

        Ok(Some(Message {
            id: id.to_string(),
            room_key: room_key.to_string(),
            sender: MessageSender {
                is_online: false, // Always set to false when restoring from persistence
                ..sender
            },
            message_type,
            content: content.clone(),
            timestamp,
            file_info,
            download_url: None, // download_url is not persisted; regenerated on demand
            file_id: file_id.clone(),
        }))
    }

    /// Execute remove_pinned_room synchronously
    fn do_remove_pinned_room(conn: &Connection, room_key: &str) -> Result<(), PersistenceError> {
        // CASCADE will automatically delete associated messages
        conn.execute("DELETE FROM pinned_rooms WHERE room_key = ?1", [room_key])
            .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Execute update_room_password synchronously
    fn do_update_room_password(
        conn: &Connection,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError> {
        conn.execute(
            "UPDATE pinned_rooms SET password_hash = ?1, password = ?2 WHERE room_key = ?3",
            rusqlite::params![password_hash, password, room_key],
        )
        .map_err(|e| PersistenceError::Database(e.to_string()))?;

        Ok(())
    }

    /// Spawn the background writer task and return the sender
    pub fn spawn_writer(
        db_path: PathBuf,
    ) -> (
        mpsc::Sender<PersistenceCommand>,
        tokio::task::JoinHandle<()>,
    ) {
        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        let handle = tokio::spawn(async move {
            Self::writer_loop(db_path, receiver).await;
        });
        (sender, handle)
    }

    /// Main writer loop - runs in a dedicated async task
    /// All SQLite operations are performed synchronously since this is the only writer
    async fn writer_loop(db_path: PathBuf, mut receiver: mpsc::Receiver<PersistenceCommand>) {
        info!("Persistence writer task started");

        // Open connection in the writer task
        let conn = match Self::open_connection(&db_path) {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to open persistence database: {}", e);
                return;
            }
        };

        while let Some(command) = receiver.recv().await {
            match command {
                PersistenceCommand::SavePinnedRoom { room, messages } => {
                    if let Err(e) = Self::do_save_pinned_room(&conn, &room, &messages) {
                        error!("Failed to save pinned room {}: {}", room.room_key, e);
                    }
                }
                PersistenceCommand::AppendMessage { room_key, message } => {
                    if let Err(e) = Self::do_append_message(&conn, &room_key, &message) {
                        error!("Failed to append message to room {}: {}", room_key, e);
                    }
                }
                PersistenceCommand::DeleteMessage {
                    room_key,
                    message_id,
                } => {
                    if let Err(e) = Self::do_delete_message(&conn, &room_key, &message_id) {
                        error!(
                            "Failed to delete message {} from room {}: {}",
                            message_id, room_key, e
                        );
                    }
                }
                PersistenceCommand::RemovePinnedRoom { room_key } => {
                    if let Err(e) = Self::do_remove_pinned_room(&conn, &room_key) {
                        error!("Failed to remove pinned room {}: {}", room_key, e);
                    } else {
                        info!("Removed pinned room: {}", room_key);
                    }
                }
                PersistenceCommand::UpdateRoomPassword {
                    room_key,
                    password_hash,
                    password,
                } => {
                    if let Err(e) =
                        Self::do_update_room_password(&conn, &room_key, password_hash, password)
                    {
                        error!("Failed to update password for room {}: {}", room_key, e);
                    }
                }
                PersistenceCommand::Shutdown => {
                    info!("Persistence writer task shutting down");
                    break;
                }
            }
        }

        info!("Persistence writer task stopped");
    }

    /// Create a new service with a spawned writer task
    pub fn with_writer(db_path: PathBuf, max_messages: usize) -> Self {
        let (sender, _handle) = Self::spawn_writer(db_path.clone());
        Self {
            db_path,
            sender,
            max_messages,
        }
    }
}

#[async_trait]
impl PersistenceServiceTrait for SqlitePersistenceService {
    async fn initialize(&self) -> Result<(), PersistenceError> {
        // Open a connection to verify the database is accessible and schema is created
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), PersistenceError> {
            let _conn = Self::open_connection(&db_path)?;
            Ok(())
        })
        .await
        .map_err(|e| PersistenceError::Database(e.to_string()))??;

        info!("Persistence database initialized at {:?}", self.db_path);
        Ok(())
    }

    async fn save_pinned_room(
        &self,
        room: &PersistedRoom,
        messages: &[Message],
    ) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::SavePinnedRoom {
            room: room.clone(),
            messages: messages.to_vec(),
        })
    }

    async fn append_message(
        &self,
        room_key: &str,
        message: &Message,
    ) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::AppendMessage {
            room_key: room_key.to_string(),
            message: message.clone(),
        })
    }

    async fn delete_message(
        &self,
        room_key: &str,
        message_id: &str,
    ) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::DeleteMessage {
            room_key: room_key.to_string(),
            message_id: message_id.to_string(),
        })
    }

    async fn load_pinned_rooms(
        &self,
    ) -> Result<HashMap<String, (PersistedRoom, Vec<Message>)>, PersistenceError> {
        let db_path = self.db_path.clone();
        let max_messages = self.max_messages;

        tokio::task::spawn_blocking(
            move || -> Result<HashMap<String, (PersistedRoom, Vec<Message>)>, PersistenceError> {
                let conn = Self::open_connection(&db_path)?;
                Self::do_load_pinned_rooms(&conn, max_messages)
            },
        )
        .await
        .map_err(|e| PersistenceError::Database(e.to_string()))?
    }

    async fn remove_pinned_room(&self, room_key: &str) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::RemovePinnedRoom {
            room_key: room_key.to_string(),
        })
    }

    async fn update_room_password(
        &self,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::UpdateRoomPassword {
            room_key: room_key.to_string(),
            password_hash,
            password,
        })
    }

    async fn start_writer(&self) -> Result<(), PersistenceError> {
        // The writer is spawned separately via spawn_writer/with_writer
        // This method is a no-op because the writer handle is managed externally
        Ok(())
    }

    async fn shutdown(&self) -> Result<(), PersistenceError> {
        self.send_command(PersistenceCommand::Shutdown)
    }

    fn send_command(&self, command: PersistenceCommand) -> Result<(), PersistenceError> {
        match self.sender.try_send(command) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                warn!("Persistence channel full, command dropped");
                Err(PersistenceError::ChannelFull)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                error!("Persistence channel closed");
                Err(PersistenceError::ChannelClosed)
            }
        }
    }
}
