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
    pub is_pinned: bool,
    pub created_by: Option<String>, // fingerprint hash of room creator
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
    pub is_pinned: bool,
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
            is_pinned: false,
            created_by: None,
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

    /// Remove a message by ID, returns true if found and removed
    pub fn remove_message(&mut self, message_id: &str) -> bool {
        let initial_len = self.messages.len();
        self.messages.retain(|m| m.id != message_id);
        let removed = self.messages.len() < initial_len;
        if removed {
            self.update_activity();
        }
        removed
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
            is_pinned: self.is_pinned,
        }
    }

    pub fn pin(&mut self) {
        self.is_pinned = true;
        self.update_activity();
    }

    pub fn unpin(&mut self) {
        self.is_pinned = false;
        self.update_activity();
    }

    pub fn set_creator(&mut self, fingerprint: &str) {
        if self.created_by.is_none() {
            self.created_by = Some(fingerprint.to_string());
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
                && fingerprint.is_none_or(|fp| u.fingerprint.as_deref() != Some(fp))
        })
    }

    /// Generate unique username with random suffix if needed
    pub fn generate_unique_username(
        &self,
        base_username: &str,
        fingerprint: Option<&str>,
    ) -> String {
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
        self.users
            .values()
            .find(|u| u.fingerprint.as_deref() == Some(hash))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::User;

    fn make_room_with_user(username: &str, fingerprint: Option<&str>) -> Room {
        let mut room = Room::new("test_room1".to_string(), None, None);
        let mut user = User::new(
            "user1".to_string(),
            username.to_string(),
            "test_room1".to_string(),
        );
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

    #[test]
    fn test_add_remove_user() {
        let mut room = Room::new("room1".to_string(), None, None);
        let user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        room.add_user(user);
        assert_eq!(room.user_count(), 1);
        assert!(!room.is_empty());

        let removed = room.remove_user("u1");
        assert!(removed.is_some());
        assert_eq!(room.user_count(), 0);
        assert!(room.is_empty());
    }

    #[test]
    fn test_remove_nonexistent_user() {
        let mut room = Room::new("room1".to_string(), None, None);
        let result = room.remove_user("ghost");
        assert!(result.is_none());
    }

    #[test]
    fn test_online_user_count() {
        let mut room = Room::new("room1".to_string(), None, None);
        let u1 = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        let mut u2 = User::new("u2".to_string(), "Bob".to_string(), "room1".to_string());
        u2.set_offline();
        room.add_user(u1);
        room.add_user(u2);
        assert_eq!(room.online_user_count(), 1);
    }

    #[test]
    fn test_all_users_offline() {
        let mut room = Room::new("room1".to_string(), None, None);
        let mut u1 = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        u1.set_offline();
        room.add_user(u1);
        assert!(room.all_users_offline());
    }

    #[test]
    fn test_not_all_users_offline_when_some_online() {
        let mut room = Room::new("room1".to_string(), None, None);
        room.add_user(User::new(
            "u1".to_string(),
            "Alice".to_string(),
            "room1".to_string(),
        ));
        assert!(!room.all_users_offline());
    }

    #[test]
    fn test_add_and_remove_message() {
        let mut room = Room::new("room1".to_string(), None, None);
        let msg = Message::new_system("m1".to_string(), "room1".to_string(), "hello".to_string());
        room.add_message(msg);
        assert_eq!(room.get_messages().len(), 1);

        let removed = room.remove_message("m1");
        assert!(removed);
        assert_eq!(room.get_messages().len(), 0);
    }

    #[test]
    fn test_remove_nonexistent_message() {
        let mut room = Room::new("room1".to_string(), None, None);
        let msg = Message::new_system("m1".to_string(), "room1".to_string(), "hello".to_string());
        room.add_message(msg);
        let removed = room.remove_message("ghost");
        assert!(!removed);
        assert_eq!(room.get_messages().len(), 1);
    }

    #[test]
    fn test_has_password() {
        let room_no_pw = Room::new("room1".to_string(), None, None);
        assert!(!room_no_pw.has_password());

        let room_with_pw = Room::new("room2".to_string(), None, Some("hash".to_string()));
        assert!(room_with_pw.has_password());
    }

    #[test]
    fn test_pin_unpin() {
        let mut room = Room::new("room1".to_string(), None, None);
        assert!(!room.is_pinned);
        room.pin();
        assert!(room.is_pinned);
        room.unpin();
        assert!(!room.is_pinned);
    }

    #[test]
    fn test_set_creator() {
        let mut room = Room::new("room1".to_string(), None, None);
        room.set_creator("fp123");
        assert_eq!(room.created_by.as_deref(), Some("fp123"));
        // Second call does not override
        room.set_creator("fp456");
        assert_eq!(room.created_by.as_deref(), Some("fp123"));
    }

    #[test]
    fn test_to_info() {
        let mut room = Room::new("room1".to_string(), None, None);
        room.add_user(User::new(
            "u1".to_string(),
            "Alice".to_string(),
            "room1".to_string(),
        ));
        let info = room.to_info();
        assert_eq!(info.room_key, "room1");
        assert_eq!(info.user_count, 1);
        assert!(!info.has_password);
        assert!(!info.is_pinned);
    }

    #[test]
    fn test_find_user_by_fingerprint() {
        let mut room = Room::new("room1".to_string(), None, None);
        let mut user = User::new("u1".to_string(), "Alice".to_string(), "room1".to_string());
        user.fingerprint = Some("fp123".to_string());
        room.add_user(user);

        let found = room.find_user_by_fingerprint("fp123");
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "u1");

        let not_found = room.find_user_by_fingerprint("fp456");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_get_user_mut() {
        let mut room = Room::new("room1".to_string(), None, None);
        room.add_user(User::new(
            "u1".to_string(),
            "Alice".to_string(),
            "room1".to_string(),
        ));
        let user = room.get_user_mut("u1");
        assert!(user.is_some());
        let user = room.get_user_mut("ghost");
        assert!(user.is_none());
    }

    #[test]
    fn test_verify_password_no_password_accepts_anything() {
        let room = Room::new("room1".to_string(), None, None);
        assert!(room.verify_password("anything"));
        assert!(room.verify_password(""));
    }

    #[test]
    fn test_message_overflow_drops_oldest() {
        let mut room = Room::new("room1".to_string(), None, None);
        // Add more than max_messages (1000)
        for i in 0..1005 {
            let msg =
                Message::new_system(format!("m{}", i), "room1".to_string(), "msg".to_string());
            room.add_message(msg);
        }
        // Should have dropped ~200 messages (20% of 1000)
        assert!(room.get_messages().len() <= 1000);
    }
}
