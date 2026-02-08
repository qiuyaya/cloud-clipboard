use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Message type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MessageType {
    Text,
    File,
    System,
}

/// Sender info embedded in messages (matches frontend UserSchema)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSender {
    pub id: String,
    pub name: String,
    pub is_online: bool,
    pub last_seen: DateTime<Utc>,
    pub device_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

impl MessageSender {
    pub fn from_user(user: &super::User) -> Self {
        Self {
            id: user.id.clone(),
            name: user.username.clone(),
            is_online: user.is_online,
            last_seen: user.last_seen,
            device_type: user.device_type.clone(),
            fingerprint: user.fingerprint.clone(),
        }
    }

    pub fn system() -> Self {
        Self {
            id: "system".to_string(),
            name: "System".to_string(),
            is_online: true,
            last_seen: Utc::now(),
            device_type: "desktop".to_string(),
            fingerprint: None,
        }
    }
}

/// Message in a room
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub room_key: String,
    pub sender: MessageSender,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

impl Message {
    pub fn new_text(
        id: String,
        room_key: String,
        sender: MessageSender,
        content: String,
    ) -> Self {
        Self {
            id,
            room_key,
            sender,
            message_type: MessageType::Text,
            content,
            timestamp: Utc::now(),
            file_name: None,
            file_size: None,
            file_type: None,
            download_url: None,
        }
    }

    pub fn new_file(
        id: String,
        room_key: String,
        sender: MessageSender,
        file_name: String,
        file_size: u64,
        file_type: String,
        download_url: String,
    ) -> Self {
        Self {
            id,
            room_key,
            sender,
            message_type: MessageType::File,
            content: format!("Shared file: {}", file_name),
            timestamp: Utc::now(),
            file_name: Some(file_name),
            file_size: Some(file_size),
            file_type: Some(file_type),
            download_url: Some(download_url),
        }
    }

    pub fn new_system(id: String, room_key: String, content: String) -> Self {
        Self {
            id,
            room_key,
            sender: MessageSender::system(),
            message_type: MessageType::System,
            content,
            timestamp: Utc::now(),
            file_name: None,
            file_size: None,
            file_type: None,
            download_url: None,
        }
    }
}
