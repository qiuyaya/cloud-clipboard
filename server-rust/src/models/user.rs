use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// User in a room
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    #[serde(rename = "name")]
    pub username: String,
    pub room_key: String,
    pub is_online: bool,
    pub last_seen: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(default = "default_device_type")]
    pub device_type: String,
}

fn default_device_type() -> String {
    "desktop".to_string()
}

impl User {
    pub fn new(id: String, username: String, room_key: String) -> Self {
        Self {
            id,
            username,
            room_key,
            is_online: true,
            last_seen: Utc::now(),
            fingerprint: None,
            device_type: "desktop".to_string(),
        }
    }

    pub fn update_activity(&mut self) {
        self.last_seen = Utc::now();
        self.is_online = true;
    }

    pub fn set_offline(&mut self) {
        self.is_online = false;
        self.last_seen = Utc::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_user_is_online() {
        let user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        assert_eq!(user.id, "u1");
        assert_eq!(user.username, "Alice");
        assert_eq!(user.room_key, "room1");
        assert!(user.is_online);
        assert!(user.fingerprint.is_none());
        assert_eq!(user.device_type, "desktop");
    }

    #[test]
    fn update_activity_stays_online() {
        let mut user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        user.is_online = false;
        user.update_activity();
        assert!(user.is_online);
    }

    #[test]
    fn set_offline_marks_offline() {
        let mut user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        user.set_offline();
        assert!(!user.is_online);
    }

    #[test]
    fn serialization_camel_case() {
        let user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("\"name\":\"Alice\""));
        assert!(json.contains("\"isOnline\":true"));
        assert!(json.contains("\"deviceType\":\"desktop\""));
    }

    #[test]
    fn default_device_type_is_desktop() {
        let user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        assert_eq!(user.device_type, "desktop");
    }

    #[test]
    fn fingerprint_is_skip_if_none() {
        let user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        let json = serde_json::to_string(&user).unwrap();
        assert!(!json.contains("fingerprint"));
    }

    #[test]
    fn fingerprint_included_when_some() {
        let mut user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        user.fingerprint = Some("fp123".to_string());
        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("\"fingerprint\":\"fp123\""));
    }

    #[test]
    fn default_device_type_via_deserialize() {
        let json = r#"{"id":"u1","name":"Bob","roomKey":"r1","isOnline":true,"lastSeen":"2024-01-01T00:00:00Z"}"#;
        let user: User = serde_json::from_str(json).unwrap();
        assert_eq!(user.device_type, "desktop");
    }

    #[test]
    fn custom_device_type_via_deserialize() {
        let json = r#"{"id":"u1","name":"Bob","roomKey":"r1","isOnline":true,"lastSeen":"2024-01-01T00:00:00Z","deviceType":"mobile"}"#;
        let user: User = serde_json::from_str(json).unwrap();
        assert_eq!(user.device_type, "mobile");
    }
}
