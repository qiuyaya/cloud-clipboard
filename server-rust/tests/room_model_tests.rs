/// Room Model Coverage Tests
///
/// These tests verify Room model behaviors matching the Node.js
/// backend RoomModel implementation
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    #[derive(Debug, Clone)]
    struct User {
        id: String,
        name: String,
        is_online: bool,
        device_type: String,
        fingerprint: Option<String>,
    }

    #[derive(Debug, Clone)]
    struct TextMessage {
        id: String,
        msg_type: String,
        content: String,
        room_key: String,
        sender: User,
    }

    struct RoomModel {
        key: String,
        users: HashMap<String, User>,
        messages: Vec<TextMessage>,
    }

    impl RoomModel {
        fn new(key: &str) -> Self {
            Self {
                key: key.to_string(),
                users: HashMap::new(),
                messages: Vec::new(),
            }
        }

        fn add_user(&mut self, user: User) {
            let mut user = user;
            user.is_online = true; // addUser sets isOnline to true
            self.users.insert(user.id.clone(), user);
        }

        fn remove_user(&mut self, user_id: &str) -> bool {
            self.users.remove(user_id).is_some()
        }

        fn get_user(&self, user_id: &str) -> Option<&User> {
            self.users.get(user_id)
        }

        fn get_user_list(&self) -> Vec<User> {
            self.users.values().cloned().collect()
        }

        fn is_empty(&self) -> bool {
            self.users.is_empty()
        }

        fn update_user_status(&mut self, user_id: &str, is_online: bool) {
            if let Some(user) = self.users.get_mut(user_id) {
                user.is_online = is_online;
            }
        }

        fn add_message(&mut self, message: TextMessage) {
            self.messages.push(message);
        }

        fn get_messages(&self, limit: Option<usize>) -> Vec<&TextMessage> {
            match limit {
                Some(n) => self.messages.iter().take(n).collect(),
                None => self.messages.iter().collect(),
            }
        }

        fn get_online_users(&self) -> Vec<User> {
            self.users
                .values()
                .filter(|u| u.is_online)
                .cloned()
                .collect()
        }
    }

    #[test]
    fn test_handles_room_operations() {
        let mut room = RoomModel::new("test-room");

        let user1 = User {
            id: "user1".to_string(),
            name: "Test User 1".to_string(),
            is_online: true,
            device_type: "desktop".to_string(),
            fingerprint: Some("fp1".to_string()),
        };

        let user2 = User {
            id: "user2".to_string(),
            name: "Test User 2".to_string(),
            is_online: false,
            device_type: "mobile".to_string(),
            fingerprint: Some("fp2".to_string()),
        };

        // Test adding users
        room.add_user(user1.clone());
        room.add_user(user2.clone());

        assert_eq!(room.users.len(), 2);
        assert_eq!(room.get_user_list().len(), 2);

        // Test removing users
        let removed = room.remove_user("user1");
        assert!(removed);
        assert_eq!(room.users.len(), 1);
        assert_eq!(room.get_user_list().len(), 1);

        // Test getting user
        let found_user = room.get_user("user2");
        assert!(found_user.is_some());
        assert_eq!(found_user.unwrap().name, "Test User 2");
        assert_eq!(found_user.unwrap().device_type, "mobile");
        assert!(found_user.unwrap().is_online); // Should be set to true by addUser
        assert_eq!(found_user.unwrap().fingerprint, Some("fp2".to_string()));

        // Test non-existent user
        let not_found = room.get_user("nonexistent");
        assert!(not_found.is_none());

        // Test room properties
        assert_eq!(room.key, "test-room");
        assert_eq!(room.messages.len(), 0);

        // Test isEmpty
        room.remove_user("user2");
        assert!(room.is_empty());
    }

    #[test]
    fn test_handles_edge_cases() {
        let mut room = RoomModel::new("edge-case-room");

        // Test with empty users
        assert!(room.is_empty());
        assert_eq!(room.users.len(), 0);
        assert_eq!(room.get_user_list().len(), 0);

        // Test removing non-existent user
        let removed = room.remove_user("does-not-exist");
        assert!(!removed);
        assert_eq!(room.users.len(), 0);

        // Test adding same user twice
        let user = User {
            id: "duplicate-user".to_string(),
            name: "Duplicate".to_string(),
            is_online: true,
            device_type: "desktop".to_string(),
            fingerprint: Some("dup-fp".to_string()),
        };

        room.add_user(user.clone());
        room.add_user(user.clone()); // Add again - should overwrite

        // Should still only have one user
        assert_eq!(room.users.len(), 1);
        assert_eq!(room.get_user_list().len(), 1);
    }

    #[test]
    fn test_handles_user_status_updates() {
        let mut room = RoomModel::new("status-room");

        let user = User {
            id: "status-user".to_string(),
            name: "Status User".to_string(),
            is_online: false,
            device_type: "tablet".to_string(),
            fingerprint: Some("status-fp".to_string()),
        };

        room.add_user(user);

        // Test updating user status
        room.update_user_status("status-user", false);
        let updated_user = room.get_user("status-user");
        assert!(!updated_user.unwrap().is_online);

        // Test updating non-existent user
        room.update_user_status("nonexistent", true);
        assert_eq!(room.users.len(), 1);
    }

    #[test]
    fn test_handles_messages() {
        let mut room = RoomModel::new("message-room");

        let test_user = User {
            id: "user1".to_string(),
            name: "Test User".to_string(),
            is_online: true,
            device_type: "desktop".to_string(),
            fingerprint: Some("test-fingerprint".to_string()),
        };

        let text_message = TextMessage {
            id: "msg1".to_string(),
            msg_type: "text".to_string(),
            content: "Hello world".to_string(),
            room_key: "message-room".to_string(),
            sender: test_user,
        };

        room.add_message(text_message);
        assert_eq!(room.messages.len(), 1);

        let messages = room.get_messages(None);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Hello world");
        assert_eq!(messages[0].id, "msg1");
        assert_eq!(messages[0].msg_type, "text");
        assert_eq!(messages[0].room_key, "message-room");
        assert_eq!(messages[0].sender.name, "Test User");

        // Test message limit
        let messages_with_limit = room.get_messages(Some(1));
        assert_eq!(messages_with_limit.len(), 1);
    }

    #[test]
    fn test_handles_online_users() {
        let mut room = RoomModel::new("online-room");

        let user1 = User {
            id: "online1".to_string(),
            name: "Online User 1".to_string(),
            is_online: true,
            device_type: "desktop".to_string(),
            fingerprint: Some("online1-fp".to_string()),
        };

        let user2 = User {
            id: "online2".to_string(),
            name: "Online User 2".to_string(),
            is_online: false,
            device_type: "mobile".to_string(),
            fingerprint: Some("online2-fp".to_string()),
        };

        room.add_user(user1);
        room.add_user(user2);

        // Both users should be online after being added (addUser sets isOnline: true)
        let online_users = room.get_online_users();
        assert_eq!(online_users.len(), 2);

        // Update one user to offline
        room.update_user_status("online2", false);
        let online_users_after_update = room.get_online_users();
        assert_eq!(online_users_after_update.len(), 1);
        assert_eq!(online_users_after_update[0].id, "online1");
    }
}
