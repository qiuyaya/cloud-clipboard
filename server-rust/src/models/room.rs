use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

use super::{Message, User};

/// Room model containing users and messages
#[derive(Debug, Clone)]
pub struct Room {
    pub room_key: String,
    pub password_hash: Option<String>,
    pub password: Option<String>,
    pub users: HashMap<String, User>,
    pub messages: VecDeque<Message>,
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
    pub last_activity: DateTime<Utc>,
}

impl Room {
    pub fn new(room_key: String, password: Option<String>, password_hash: Option<String>) -> Self {
        let now = Utc::now();
        Self {
            room_key,
            password_hash,
            password,
            users: HashMap::new(),
            messages: VecDeque::new(),
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

    pub fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.users.get_mut(user_id)
    }

    pub fn get_users(&self) -> Vec<&User> {
        self.users.values().collect()
    }

    pub fn user_count(&self) -> usize {
        self.users.len()
    }

    pub fn online_user_count(&self) -> usize {
        self.users.values().filter(|u| u.is_online).count()
    }

    pub fn add_message(&mut self, message: Message) {
        self.messages.push_back(message);
        self.message_count += 1;

        // Drop oldest 20% when exceeding max to avoid frequent removals
        if self.messages.len() > self.max_messages {
            let remove_count = self.max_messages / 5;
            self.messages.drain(..remove_count);
            self.message_dropped_count += remove_count as u64;
        }

        self.update_activity();
    }

    pub fn get_messages(&self) -> &VecDeque<Message> {
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
            last_activity: self.last_activity,
        }
    }

    fn update_activity(&mut self) {
        self.last_activity = Utc::now();
    }

    /// Check if username already exists in room (case-insensitive, excluding same fingerprint)
    fn username_conflict(&self, username: &str, fingerprint: Option<&str>) -> bool {
        let lower = username.to_lowercase();
        self.users.values().any(|u| {
            u.username.to_lowercase() == lower
                && fingerprint.map_or(true, |fp| u.fingerprint.as_deref() != Some(fp))
        })
    }

    /// Generate unique username with random suffix if needed
    pub fn generate_unique_username(&self, base_username: &str, fingerprint: Option<&str>) -> String {
        let max_length = 50;
        let max_base_length = 44; // Leave room for "_" + 5 char suffix

        if !self.username_conflict(base_username, fingerprint) {
            return if base_username.len() > max_length {
                base_username[..max_length].to_string()
            } else {
                base_username.to_string()
            };
        }

        // Name conflicts, try up to 10 times with random suffix
        let base = if base_username.len() > max_base_length {
            &base_username[..max_base_length]
        } else {
            base_username
        };

        use rand::Rng;
        for _ in 0..10 {
            let suffix: String = rand::rng()
                .sample_iter(&rand::distr::Alphanumeric)
                .take(5)
                .map(|b| (b as char).to_ascii_lowercase())
                .collect();
            let new_name = format!("{}_{}", base, suffix);
            if !self.username_conflict(&new_name, fingerprint) {
                return new_name;
            }
        }

        // Fallback: use UUID to guarantee uniqueness
        format!("{}_{}", base, &uuid::Uuid::new_v4().to_string()[..5])
    }

    /// Find user by fingerprint hash
    pub fn find_user_by_fingerprint(&self, hash: &str) -> Option<&User> {
        self.users.values().find(|u| {
            u.fingerprint.as_deref() == Some(hash)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::User;

    fn make_room_with_user(username: &str, fingerprint: Option<&str>) -> Room {
        let mut room = Room::new("test_room1".to_string(), None, None);
        let mut user = User::new("user1".to_string(), username.to_string(), "test_room1".to_string());
        user.fingerprint = fingerprint.map(|s| s.to_string());
        room.add_user(user);
        room
    }

    #[test]
    fn test_no_conflict_returns_original() {
        let room = Room::new("test_room1".to_string(), None, None);
        let name = room.generate_unique_username("Alice", None);
        assert_eq!(name, "Alice");
    }

    #[test]
    fn test_case_insensitive_conflict() {
        let room = make_room_with_user("Alice", None);
        let name = room.generate_unique_username("alice", None);
        // Should generate a suffixed name since "alice" conflicts with "Alice" case-insensitively
        assert_ne!(name.to_lowercase(), "alice");
        assert!(name.starts_with("alice_"));
    }

    #[test]
    fn test_same_fingerprint_no_conflict() {
        let room = make_room_with_user("Alice", Some("fp123"));
        // Same fingerprint should NOT trigger conflict
        let name = room.generate_unique_username("Alice", Some("fp123"));
        assert_eq!(name, "Alice");
    }

    #[test]
    fn test_different_fingerprint_conflict() {
        let room = make_room_with_user("Alice", Some("fp123"));
        // Different fingerprint SHOULD trigger conflict
        let name = room.generate_unique_username("Alice", Some("fp456"));
        assert_ne!(name, "Alice");
        assert!(name.starts_with("Alice_"));
    }

    #[test]
    fn test_long_username_truncated() {
        let room = Room::new("test_room1".to_string(), None, None);
        let long_name = "a".repeat(60);
        let name = room.generate_unique_username(&long_name, None);
        assert!(name.len() <= 50);
    }

    #[test]
    fn test_long_username_with_conflict_truncated() {
        let long_name = "a".repeat(60);
        let room = make_room_with_user(&long_name, None);
        let name = room.generate_unique_username(&long_name, None);
        // Should be base (44 chars) + "_" + 5 chars = 50 chars max
        assert!(name.len() <= 50);
        assert!(name.contains('_'));
    }

    #[test]
    fn test_suffix_format() {
        let room = make_room_with_user("Bob", None);
        let name = room.generate_unique_username("Bob", None);
        // Format: "Bob_xxxxx" where xxxxx is 5 lowercase alphanumeric chars
        assert!(name.starts_with("Bob_"));
        let suffix = &name[4..]; // after "Bob_"
        assert_eq!(suffix.len(), 5);
        assert!(suffix.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
