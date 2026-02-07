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

/// Message in a room
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub room_key: String,
    pub sender_id: String,
    pub sender_name: String,
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
        sender_id: String,
        sender_name: String,
        content: String,
    ) -> Self {
        Self {
            id,
            room_key,
            sender_id,
            sender_name,
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
        sender_id: String,
        sender_name: String,
        file_name: String,
        file_size: u64,
        file_type: String,
        download_url: String,
    ) -> Self {
        Self {
            id,
            room_key,
            sender_id,
            sender_name,
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
            sender_id: "system".to_string(),
            sender_name: "System".to_string(),
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
