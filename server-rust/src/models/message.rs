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

/// File info embedded in file messages (matches frontend FileInfoSchema)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String,
    pub last_modified: u64,
}

/// Message in a room (matches frontend TextMessage / FileMessage schemas)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub room_key: String,
    pub sender: MessageSender,
    #[serde(rename = "type")]
    pub message_type: MessageType,
    /// Text content for text messages
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub timestamp: DateTime<Utc>,
    /// File info for file messages
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_info: Option<FileInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
}

impl Message {
    pub fn new_text(id: String, room_key: String, sender: MessageSender, content: String) -> Self {
        Self {
            id,
            room_key,
            sender,
            message_type: MessageType::Text,
            content: Some(content),
            timestamp: Utc::now(),
            file_info: None,
            download_url: None,
            file_id: None,
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
            content: None,
            timestamp: Utc::now(),
            file_info: Some(FileInfo {
                name: file_name,
                size: file_size,
                file_type,
                last_modified: Utc::now().timestamp_millis() as u64,
            }),
            download_url: Some(download_url),
            file_id: None,
        }
    }

    pub fn new_system(id: String, room_key: String, content: String) -> Self {
        Self {
            id,
            room_key,
            sender: MessageSender::system(),
            message_type: MessageType::System,
            content: Some(content),
            timestamp: Utc::now(),
            file_info: None,
            download_url: None,
            file_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sender() -> MessageSender {
        MessageSender {
            id: "user1".to_string(),
            name: "Alice".to_string(),
            is_online: true,
            last_seen: Utc::now(),
            device_type: "desktop".to_string(),
            fingerprint: Some("fp123".to_string()),
        }
    }

    #[test]
    fn message_type_serialization() {
        assert_eq!(
            serde_json::to_string(&MessageType::Text).unwrap(),
            "\"text\""
        );
        assert_eq!(
            serde_json::to_string(&MessageType::File).unwrap(),
            "\"file\""
        );
        assert_eq!(
            serde_json::to_string(&MessageType::System).unwrap(),
            "\"system\""
        );
    }

    #[test]
    fn message_type_deserialization() {
        let t: MessageType = serde_json::from_str("\"text\"").unwrap();
        assert_eq!(t, MessageType::Text);
        let f: MessageType = serde_json::from_str("\"file\"").unwrap();
        assert_eq!(f, MessageType::File);
        let s: MessageType = serde_json::from_str("\"system\"").unwrap();
        assert_eq!(s, MessageType::System);
    }

    #[test]
    fn sender_from_user() {
        use crate::models::User;
        let user = User::new("u1".to_string(), "Bob".to_string(), "room1".to_string());
        let sender = MessageSender::from_user(&user);
        assert_eq!(sender.id, "u1");
        assert_eq!(sender.name, "Bob");
        assert!(sender.is_online);
        assert_eq!(sender.device_type, "desktop");
        assert!(sender.fingerprint.is_none());
    }

    #[test]
    fn system_sender() {
        let sender = MessageSender::system();
        assert_eq!(sender.id, "system");
        assert_eq!(sender.name, "System");
        assert!(sender.is_online);
        assert!(sender.fingerprint.is_none());
    }

    #[test]
    fn new_text_message() {
        let msg = Message::new_text(
            "m1".to_string(),
            "room1".to_string(),
            make_sender(),
            "hello".to_string(),
        );
        assert_eq!(msg.id, "m1");
        assert_eq!(msg.message_type, MessageType::Text);
        assert_eq!(msg.content.as_deref(), Some("hello"));
        assert!(msg.file_info.is_none());
        assert!(msg.download_url.is_none());
        assert!(msg.file_id.is_none());
    }

    #[test]
    fn new_file_message() {
        let msg = Message::new_file(
            "m2".to_string(),
            "room1".to_string(),
            make_sender(),
            "photo.jpg".to_string(),
            1024,
            "image/jpeg".to_string(),
            "http://example.com/photo.jpg".to_string(),
        );
        assert_eq!(msg.id, "m2");
        assert_eq!(msg.message_type, MessageType::File);
        assert!(msg.content.is_none());
        let fi = msg.file_info.as_ref().unwrap();
        assert_eq!(fi.name, "photo.jpg");
        assert_eq!(fi.size, 1024);
        assert_eq!(fi.file_type, "image/jpeg");
        assert_eq!(
            msg.download_url.as_deref(),
            Some("http://example.com/photo.jpg")
        );
    }

    #[test]
    fn new_system_message() {
        let msg = Message::new_system(
            "m3".to_string(),
            "room1".to_string(),
            "User joined".to_string(),
        );
        assert_eq!(msg.id, "m3");
        assert_eq!(msg.message_type, MessageType::System);
        assert_eq!(msg.content.as_deref(), Some("User joined"));
        assert_eq!(msg.sender.id, "system");
    }

    #[test]
    fn message_serialization_roundtrip() {
        let msg = Message::new_text(
            "m1".to_string(),
            "room1".to_string(),
            make_sender(),
            "hello".to_string(),
        );
        let json = serde_json::to_string(&msg).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "m1");
        assert_eq!(deserialized.message_type, MessageType::Text);
    }

    #[test]
    fn file_info_serialization() {
        let fi = FileInfo {
            name: "doc.pdf".to_string(),
            size: 2048,
            file_type: "application/pdf".to_string(),
            last_modified: 1700000000000,
        };
        let json = serde_json::to_string(&fi).unwrap();
        assert!(json.contains("\"name\":\"doc.pdf\""));
        assert!(json.contains("\"type\":\"application/pdf\""));
        let de: FileInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(de.name, "doc.pdf");
        assert_eq!(de.size, 2048);
    }

    #[test]
    fn optional_fields_omitted_when_none() {
        let msg = Message::new_text(
            "m1".to_string(),
            "room1".to_string(),
            make_sender(),
            "hello".to_string(),
        );
        let json = serde_json::to_string(&msg).unwrap();
        assert!(!json.contains("fileInfo"));
        assert!(!json.contains("downloadUrl"));
        assert!(!json.contains("fileId"));
    }

    #[test]
    fn file_message_roundtrip() {
        let msg = Message::new_file(
            "m2".to_string(),
            "room1".to_string(),
            make_sender(),
            "photo.jpg".to_string(),
            1024,
            "image/jpeg".to_string(),
            "http://example.com/photo.jpg".to_string(),
        );
        let json = serde_json::to_string(&msg).unwrap();
        let de: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(de.id, "m2");
        assert_eq!(de.message_type, MessageType::File);
        assert!(de.content.is_none());
        let fi = de.file_info.as_ref().unwrap();
        assert_eq!(fi.name, "photo.jpg");
        assert_eq!(fi.size, 1024);
        assert_eq!(fi.file_type, "image/jpeg");
        assert_eq!(
            de.download_url.as_deref(),
            Some("http://example.com/photo.jpg")
        );
    }

    #[test]
    fn system_message_sender_name_is_system() {
        let msg = Message::new_system(
            "m3".to_string(),
            "room1".to_string(),
            "User joined".to_string(),
        );
        let json = serde_json::to_string(&msg).unwrap();
        let de: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(de.sender.name, "System");
        assert_eq!(de.sender.id, "system");
        assert_eq!(de.message_type, MessageType::System);
    }

    #[test]
    fn message_type_deserialization_invalid_fails() {
        let result = serde_json::from_str::<MessageType>("\"unknown\"");
        assert!(result.is_err());
    }

    #[test]
    fn sender_from_user_with_fingerprint() {
        use crate::models::User;
        let mut user = User::new("u1".to_string(), "Bob".to_string(), "room1".to_string());
        user.fingerprint = Some("fp_abc".to_string());
        let sender = MessageSender::from_user(&user);
        assert_eq!(sender.id, "u1");
        assert_eq!(sender.name, "Bob");
        assert_eq!(sender.fingerprint.as_deref(), Some("fp_abc"));
    }

    #[test]
    fn file_id_present_in_json_when_some() {
        let mut msg = Message::new_file(
            "m2".to_string(),
            "room1".to_string(),
            make_sender(),
            "photo.jpg".to_string(),
            1024,
            "image/jpeg".to_string(),
            "http://example.com/photo.jpg".to_string(),
        );
        msg.file_id = Some("file_abc123".to_string());
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"fileId\":\"file_abc123\""));
        let de: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(de.file_id.as_deref(), Some("file_abc123"));
    }
}
