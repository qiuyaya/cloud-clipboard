use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// User in a room
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
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
