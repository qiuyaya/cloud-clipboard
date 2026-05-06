pub mod noop;
pub mod sqlite;

use crate::models::Room;
use async_trait::async_trait;
use std::collections::HashMap;

/// Persistence error type
#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Channel closed")]
    ChannelClosed,

    #[error("Channel full, command dropped")]
    ChannelFull,

    #[error("Schema version mismatch: expected {expected}, found {found}")]
    SchemaVersion { expected: u32, found: u32 },
}

/// Persisted room data for reconstruction
#[derive(Debug, Clone)]
pub struct PersistedRoom {
    pub room_key: String,
    pub password_hash: Option<String>,
    pub password: Option<String>,
    pub is_pinned: bool,
    pub created_by: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: chrono::DateTime<chrono::Utc>,
    pub max_messages: usize,
    pub message_count: u64,
    pub message_dropped_count: u64,
}

/// Commands sent through the persistence channel
pub enum PersistenceCommand {
    SavePinnedRoom {
        room: PersistedRoom,
        messages: Vec<crate::models::Message>,
    },
    AppendMessage {
        room_key: String,
        message: crate::models::Message,
    },
    DeleteMessage {
        room_key: String,
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

/// Persistence service trait for room data persistence
#[async_trait]
pub trait PersistenceServiceTrait: Send + Sync {
    /// Initialize the persistence backend (create tables, directories, etc.)
    async fn initialize(&self) -> Result<(), PersistenceError>;

    /// Save a pinned room with all its messages (full replacement)
    async fn save_pinned_room(
        &self,
        room: &PersistedRoom,
        messages: &[crate::models::Message],
    ) -> Result<(), PersistenceError>;

    /// Append a single message to a pinned room
    async fn append_message(
        &self,
        room_key: &str,
        message: &crate::models::Message,
    ) -> Result<(), PersistenceError>;

    /// Delete a single message from a pinned room
    async fn delete_message(
        &self,
        room_key: &str,
        message_id: &str,
    ) -> Result<(), PersistenceError>;

    /// Load all pinned rooms with their messages
    async fn load_pinned_rooms(
        &self,
    ) -> Result<HashMap<String, (PersistedRoom, Vec<crate::models::Message>)>, PersistenceError>;

    /// Remove a pinned room and all its messages
    async fn remove_pinned_room(&self, room_key: &str) -> Result<(), PersistenceError>;

    /// Update room password hash
    async fn update_room_password(
        &self,
        room_key: &str,
        password_hash: Option<String>,
        password: Option<String>,
    ) -> Result<(), PersistenceError>;

    /// Start the background writer task
    async fn start_writer(&self) -> Result<(), PersistenceError>;

    /// Shutdown the persistence service
    async fn shutdown(&self) -> Result<(), PersistenceError>;

    /// Synchronously send a command to the persistence channel
    /// Uses try_send, drops command if channel is full (logs warning)
    fn send_command(&self, command: PersistenceCommand) -> Result<(), PersistenceError>;
}

/// Conversion from Room to PersistedRoom
impl PersistedRoom {
    /// Create a PersistedRoom from a Room reference
    pub fn from_room(room: &Room) -> Self {
        Self {
            room_key: room.room_key.clone(),
            password_hash: room.password_hash.clone(),
            password: room.password.clone(),
            is_pinned: room.is_pinned,
            created_by: room.created_by.clone(),
            created_at: room.created_at,
            last_activity: room.last_activity,
            max_messages: room.max_messages(),
            message_count: room.message_count(),
            message_dropped_count: room.message_dropped_count(),
        }
    }
}
