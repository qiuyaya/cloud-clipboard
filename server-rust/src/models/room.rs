use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::{Message, User};

/// Room model containing users and messages
#[derive(Debug, Clone)]
pub struct Room {
    pub room_key: String,
    pub password_hash: Option<String>,
    pub password: Option<String>,
    pub users: HashMap<String, User>,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    max_messages: usize,
    message_count: u64,
    message_dropped_count: u64,
}

/// Room info for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfo {
    pub room_key: String,
    pub user_count: usize,
    pub has_password: bool,
    pub created_at: DateTime<Utc>,
}

impl Room {
    pub fn new(room_key: String, password: Option<String>, password_hash: Option<String>) -> Self {
        let now = Utc::now();
        Self {
            room_key,
            password_hash,
            password,
            users: HashMap::new(),
            messages: Vec::new(),
            created_at: now,
            last_activity: now,
            max_messages: 1000,
            message_count: 0,
            message_dropped_count: 0,
        }
    }

    pub fn add_user(&mut self, user: User) {
        self.users.insert(user.id.clone(), user);
        self.update_activity();
    }

    pub fn remove_user(&mut self, user_id: &str) -> Option<User> {
        let user = self.users.remove(user_id);
        self.update_activity();
        user
    }

    pub fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    pub fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.users.get_mut(user_id)
    }

    pub fn get_users(&self) -> Vec<&User> {
        self.users.values().collect()
    }

    pub fn get_online_users(&self) -> Vec<&User> {
        self.users.values().filter(|u| u.is_online).collect()
    }

    pub fn user_count(&self) -> usize {
        self.users.len()
    }

    pub fn online_user_count(&self) -> usize {
        self.users.values().filter(|u| u.is_online).count()
    }

    pub fn add_message(&mut self, message: Message) {
        self.messages.push(message);
        self.message_count += 1;

        // Drop oldest 20% when exceeding max to avoid frequent removals
        if self.messages.len() > self.max_messages {
            let remove_count = self.max_messages / 5;
            self.messages.drain(..remove_count);
            self.message_dropped_count += remove_count as u64;
        }

        self.update_activity();
    }

    pub fn get_messages(&self) -> &[Message] {
        &self.messages
    }

    pub fn has_password(&self) -> bool {
        self.password_hash.is_some()
    }

    pub fn verify_password(&self, password: &str) -> bool {
        match &self.password_hash {
            Some(hash) => bcrypt::verify(password, hash).unwrap_or(false),
            None => true,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.users.is_empty()
    }

    pub fn all_users_offline(&self) -> bool {
        self.users.values().all(|u| !u.is_online)
    }

    pub fn to_info(&self) -> RoomInfo {
        RoomInfo {
            room_key: self.room_key.clone(),
            user_count: self.user_count(),
            has_password: self.has_password(),
            created_at: self.created_at,
        }
    }

    fn update_activity(&mut self) {
        self.last_activity = Utc::now();
    }

    /// Check if username already exists in room
    pub fn username_exists(&self, username: &str) -> bool {
        self.users.values().any(|u| u.username == username)
    }

    /// Generate unique username with random suffix if needed
    pub fn generate_unique_username(&self, base_username: &str) -> String {
        if !self.username_exists(base_username) {
            return base_username.to_string();
        }

        // Generate random suffix
        use rand::Rng;
        let mut rng = rand::rng();
        let suffix: String = (0..6)
            .map(|_| {
                let idx = rng.random_range(0..36);
                if idx < 10 {
                    (b'0' + idx) as char
                } else {
                    (b'a' + idx - 10) as char
                }
            })
            .collect();

        format!("{}_{}", base_username, suffix)
    }

    /// Get message statistics
    pub fn get_message_stats(&self) -> MessageStats {
        MessageStats {
            total: self.messages.len() as u64,
            total_processed: self.message_count,
            dropped: self.message_dropped_count,
        }
    }

    /// Find user by fingerprint hash
    pub fn find_user_by_fingerprint(&self, hash: &str) -> Option<&User> {
        self.users.values().find(|u| {
            u.fingerprint.as_deref() == Some(hash)
        })
    }
}

/// Message statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageStats {
    pub total: u64,
    pub total_processed: u64,
    pub dropped: u64,
}
