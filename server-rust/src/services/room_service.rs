use chrono::{Duration, Utc};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

use crate::models::room::RoomInfo;
use crate::models::{Message, Room, User};

/// Grace period before destroying a room when all users disconnect (in seconds).
/// This allows users to reconnect after browser refresh without losing their session.
const ROOM_DESTROY_GRACE_PERIOD_SECS: u64 = 30;

/// Events emitted by RoomService
#[derive(Debug, Clone)]
pub enum RoomEvent {
    RoomDestroyed { room_key: String },
}

/// Request parameters for joining a room
#[derive(Debug, Clone)]
pub struct JoinRoomRequest<'a> {
    pub room_key: &'a str,
    pub user_id: &'a str,
    pub username: &'a str,
    pub socket_id: &'a str,
    pub password: Option<&'a str>,
    pub device_type: &'a str,
    pub fingerprint: Option<&'a str>,
}

impl<'a> JoinRoomRequest<'a> {
    /// Create a request with common defaults (desktop device, no password, no fingerprint)
    pub fn new(room_key: &'a str, user_id: &'a str, username: &'a str, socket_id: &'a str) -> Self {
        Self {
            room_key,
            user_id,
            username,
            socket_id,
            password: None,
            device_type: "desktop",
            fingerprint: None,
        }
    }

    pub fn with_password(mut self, password: &'a str) -> Self {
        self.password = Some(password);
        self
    }

    pub fn with_fingerprint(mut self, fingerprint: &'a str) -> Self {
        self.fingerprint = Some(fingerprint);
        self
    }

    pub fn with_device_type(mut self, device_type: &'a str) -> Self {
        self.device_type = device_type;
        self
    }
}

/// Service for managing rooms
pub struct RoomService {
    rooms: RwLock<HashMap<String, Room>>,
    socket_users: RwLock<HashMap<String, User>>, // socket_id -> User
    user_sockets: RwLock<HashMap<String, String>>, // user_id -> socket_id
    event_sender: broadcast::Sender<RoomEvent>,
}

impl RoomService {
    pub fn new() -> Self {
        let (event_sender, _) = broadcast::channel(64);
        Self {
            rooms: RwLock::new(HashMap::new()),
            socket_users: RwLock::new(HashMap::new()),
            user_sockets: RwLock::new(HashMap::new()),
            event_sender,
        }
    }

    /// Subscribe to room events
    pub fn subscribe(&self) -> broadcast::Receiver<RoomEvent> {
        self.event_sender.subscribe()
    }

    /// Create a new room (idempotent - returns existing room if already exists)
    pub fn create_room(&self, room_key: &str, password: Option<&str>) -> Result<RoomInfo, String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        if let Some(room) = rooms.get(room_key) {
            // Room already exists, return existing room info (idempotent, matching Node.js behavior)
            return Ok(room.to_info());
        }

        let password_hash = match password {
            Some(p) => Some(
                bcrypt::hash(p, bcrypt::DEFAULT_COST)
                    .map_err(|e| format!("Password hash error: {}", e))?,
            ),
            None => None,
        };

        let room = Room::new(
            room_key.to_string(),
            password.map(|p| p.to_string()),
            password_hash,
        );
        let info = room.to_info();
        rooms.insert(room_key.to_string(), room);

        tracing::info!("Room created: {}", room_key);
        Ok(info)
    }

    /// Get room info
    pub fn get_room_info(&self, room_key: &str) -> Option<RoomInfo> {
        let rooms = self.rooms.read().ok()?;
        rooms.get(room_key).map(|r| r.to_info())
    }

    /// Check if room exists
    pub fn room_exists(&self, room_key: &str) -> bool {
        self.rooms
            .read()
            .map(|rooms| rooms.contains_key(room_key))
            .unwrap_or(false)
    }

    /// Check if room has password
    pub fn room_has_password(&self, room_key: &str) -> bool {
        self.rooms
            .read()
            .ok()
            .and_then(|rooms| rooms.get(room_key).map(|r| r.has_password()))
            .unwrap_or(false)
    }

    /// Get room password (plaintext) for share link generation
    pub fn get_room_password(&self, room_key: &str) -> Option<String> {
        self.rooms
            .read()
            .ok()
            .and_then(|rooms| rooms.get(room_key).and_then(|r| r.password.clone()))
    }

    /// Verify room password
    pub fn verify_room_password(&self, room_key: &str, password: &str) -> Result<bool, String> {
        let rooms = self.rooms.read().map_err(|_| "Lock error")?;
        match rooms.get(room_key) {
            Some(room) => Ok(room.verify_password(password)),
            None => Err("Room not found".to_string()),
        }
    }

    /// Join a room
    pub fn join_room(&self, req: JoinRoomRequest) -> Result<(User, Vec<User>), String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        // Create room if it doesn't exist
        let room = rooms
            .entry(req.room_key.to_string())
            .or_insert_with(|| Room::new(req.room_key.to_string(), None, None));

        // Verify password if room has one
        if room.has_password() {
            match req.password {
                Some(pwd) if room.verify_password(pwd) => {}
                Some(_) => return Err("Invalid password".to_string()),
                None => return Err("Password required".to_string()),
            }
        }

        // Check if user with this fingerprint already exists (reconnection)
        if let Some(fp) = req.fingerprint
            && let Some(existing_user) = room.find_user_by_fingerprint(fp)
        {
            let mut user = existing_user.clone();
            user.update_activity();

            // Update socket mappings
            {
                let mut socket_users = self.socket_users.write().map_err(|_| "Lock error")?;
                let mut user_sockets = self.user_sockets.write().map_err(|_| "Lock error")?;
                // Remove old socket mapping
                if let Some(old_socket) = user_sockets.get(&user.id) {
                    socket_users.remove(old_socket);
                }
                socket_users.insert(req.socket_id.to_string(), user.clone());
                user_sockets.insert(user.id.clone(), req.socket_id.to_string());
            }

            // Update user in room
            if let Some(u) = room.get_user_mut(&user.id) {
                u.update_activity();
            }

            let users: Vec<User> = room.get_users().into_iter().cloned().collect();
            tracing::info!(
                "User {} reconnected to room {} via fingerprint",
                user.username,
                req.room_key
            );
            return Ok((user, users));
        }

        // Generate unique username
        let unique_username = room.generate_unique_username(req.username, req.fingerprint);

        // Create user
        let mut user = User::new(
            req.user_id.to_string(),
            unique_username,
            req.room_key.to_string(),
        );
        user.device_type = req.device_type.to_string();
        user.fingerprint = req.fingerprint.map(|f| f.to_string());
        room.add_user(user.clone());

        // Track socket mapping
        {
            let mut socket_users = self.socket_users.write().map_err(|_| "Lock error")?;
            let mut user_sockets = self.user_sockets.write().map_err(|_| "Lock error")?;
            socket_users.insert(req.socket_id.to_string(), user.clone());
            user_sockets.insert(req.user_id.to_string(), req.socket_id.to_string());
        }

        let users: Vec<User> = room.get_users().into_iter().cloned().collect();

        tracing::info!("User {} joined room {}", user.username, req.room_key);
        Ok((user, users))
    }

    /// Update user online status
    pub fn update_user_status(&self, room_key: &str, user_id: &str, is_online: bool) {
        let mut rooms = match self.rooms.write() {
            Ok(r) => r,
            Err(_) => return,
        };
        if let Some(room) = rooms.get_mut(room_key)
            && let Some(u) = room.get_user_mut(user_id)
        {
            if is_online {
                u.update_activity();
            } else {
                u.set_offline();
            }
        }
        // NOTE: Don't immediately destroy the room when all users go offline.
        // A grace period is needed to allow users to reconnect after browser refresh.
        // Room cleanup is handled by schedule_room_destroy_check() and cleanup_inactive_rooms().
    }

    /// Schedule a delayed check to destroy a room if all users are still offline.
    /// Called after a user disconnects to give a grace period for reconnection.
    pub fn schedule_room_destroy_check(self: &Arc<Self>, room_key: &str) {
        let room_key = room_key.to_string();
        let service = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(
                ROOM_DESTROY_GRACE_PERIOD_SECS,
            ))
            .await;
            let should_destroy = {
                let mut rooms = match service.rooms.write() {
                    Ok(r) => r,
                    Err(_) => return,
                };
                if let Some(room) = rooms.get(&room_key) {
                    if room.all_users_offline() {
                        rooms.remove(&room_key);
                        tracing::info!(
                            "Room {} destroyed (all users offline after grace period)",
                            room_key
                        );
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            };
            if should_destroy {
                let _ = service
                    .event_sender
                    .send(RoomEvent::RoomDestroyed { room_key });
            }
        });
    }

    /// Leave a room
    pub fn leave_room(&self, socket_id: &str) -> Option<(String, User)> {
        // Unified lock order: rooms → socket_users → user_sockets
        let mut rooms = self.rooms.write().ok()?;
        let mut socket_users = self.socket_users.write().ok()?;
        let mut user_sockets = self.user_sockets.write().ok()?;

        // Remove from socket mappings
        let user = socket_users.remove(socket_id)?;
        user_sockets.remove(&user.id);

        let room_key = user.room_key.clone();
        let mut room_destroyed = false;

        // Remove from room
        if let Some(room) = rooms.get_mut(&room_key) {
            room.remove_user(&user.id);

            // Check if room should be destroyed
            if room.is_empty() || room.all_users_offline() {
                let key = room_key.clone();
                rooms.remove(&key);
                tracing::info!("Room {} destroyed (empty/all offline after leave)", key);
                room_destroyed = true;
            }
        }

        // Drop locks before sending event
        drop(rooms);
        drop(socket_users);
        drop(user_sockets);

        if room_destroyed {
            let _ = self.event_sender.send(RoomEvent::RoomDestroyed {
                room_key: room_key.clone(),
            });
        }

        tracing::info!("User {} left room {}", user.username, room_key);
        Some((room_key, user))
    }

    /// Set user offline (disconnect without removing from room)
    pub fn set_user_offline(&self, socket_id: &str) -> Option<(String, User)> {
        // Unified lock order: rooms → socket_users
        // Find user and room info first
        let (user_id, room_key) = {
            let socket_users = self.socket_users.read().ok()?;
            let user = socket_users.get(socket_id)?;
            (user.id.clone(), user.room_key.clone())
        };

        // Update status in room (handles room destruction check internally)
        self.update_user_status(&room_key, &user_id, false);

        // Retrieve updated user for return
        let socket_users = self.socket_users.read().ok()?;
        let user = socket_users.get(socket_id).cloned()?;
        Some((room_key, user))
    }

    /// Get users in a room
    pub fn get_room_users(&self, room_key: &str) -> Vec<User> {
        self.rooms
            .read()
            .map(|rooms| {
                rooms
                    .get(room_key)
                    .map(|r| r.get_users().into_iter().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    /// Find user by fingerprint in a room
    pub fn find_user_by_fingerprint(&self, room_key: &str, fingerprint_hash: &str) -> Option<User> {
        self.rooms.read().ok().and_then(|rooms| {
            rooms
                .get(room_key)
                .and_then(|r| r.find_user_by_fingerprint(fingerprint_hash).cloned())
        })
    }

    /// Add message to room
    pub fn add_message(&self, room_key: &str, message: Message) -> Result<(), String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;
        match rooms.get_mut(room_key) {
            Some(room) => {
                room.add_message(message);
                Ok(())
            }
            None => Err("Room not found".to_string()),
        }
    }

    /// Get room messages
    pub fn get_messages(&self, room_key: &str) -> Vec<Message> {
        self.rooms
            .read()
            .map(|rooms| {
                rooms
                    .get(room_key)
                    .map(|r| r.get_messages().iter().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    /// Get user by socket ID
    pub fn get_user_by_socket(&self, socket_id: &str) -> Option<User> {
        self.socket_users.read().ok()?.get(socket_id).cloned()
    }

    /// Get socket ID by user ID
    pub fn get_socket_by_user(&self, user_id: &str) -> Option<String> {
        self.user_sockets.read().ok()?.get(user_id).cloned()
    }

    /// Set or remove room password
    pub fn set_room_password(
        &self,
        room_key: &str,
        password: Option<&str>,
    ) -> Result<bool, String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;
        match rooms.get_mut(room_key) {
            Some(room) => {
                if let Some(pwd) = password {
                    let hash =
                        bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
                    room.password_hash = Some(hash);
                    room.password = Some(pwd.to_string());
                    Ok(true)
                } else {
                    room.password_hash = None;
                    room.password = None;
                    Ok(false)
                }
            }
            None => Err("Room not found".to_string()),
        }
    }

    /// Get room statistics
    pub fn get_room_stats(&self) -> RoomStats {
        let rooms = self.rooms.read().unwrap_or_else(|e| e.into_inner());
        let total_users: usize = rooms.values().map(|r| r.user_count()).sum();
        let online_users: usize = rooms.values().map(|r| r.online_user_count()).sum();

        RoomStats {
            total_rooms: rooms.len(),
            total_users,
            online_users,
        }
    }

    /// Cleanup inactive rooms (older than 24 hours with no activity)
    pub fn cleanup_inactive_rooms(&self) -> Vec<String> {
        let cutoff = Utc::now() - Duration::hours(24);
        let mut destroyed = Vec::new();

        if let Ok(mut rooms) = self.rooms.write() {
            rooms.retain(|key, room| {
                // Destroy if inactive for 24h OR all users are offline
                let inactive = room.last_activity < cutoff;
                let all_offline = !room.is_empty() && room.all_users_offline();
                let should_keep = !inactive && !all_offline;

                if !should_keep {
                    destroyed.push(key.clone());
                    tracing::info!(
                        "Room {} destroyed (cleanup: inactive={}, all_offline={})",
                        key,
                        inactive,
                        all_offline
                    );
                }
                should_keep
            });
        }

        // Send events for destroyed rooms
        for room_key in &destroyed {
            let _ = self.event_sender.send(RoomEvent::RoomDestroyed {
                room_key: room_key.clone(),
            });
        }

        destroyed
    }
}

impl Default for RoomService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStats {
    pub total_rooms: usize,
    pub total_users: usize,
    pub online_users: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::message::{MessageSender, MessageType};

    fn create_service_with_user() -> (Arc<RoomService>, String, String) {
        let service = Arc::new(RoomService::new());
        let room_key = "test1room";
        let socket_id = "socket1";

        service
            .join_room(
                JoinRoomRequest::new(room_key, "user1", "TestUser", socket_id)
                    .with_fingerprint("fp_hash_1"),
            )
            .unwrap();

        (service, room_key.to_string(), socket_id.to_string())
    }

    // Constructor tests
    #[test]
    fn test_constructor_creates_service() {
        let service = RoomService::new();
        let stats = service.get_room_stats();
        assert_eq!(stats.total_rooms, 0);
        assert_eq!(stats.total_users, 0);
        assert_eq!(stats.online_users, 0);
    }

    // createRoom tests
    #[test]
    fn test_create_room_new() {
        let service = RoomService::new();
        let result = service.create_room("newroom", None);
        assert!(result.is_ok());
        assert!(service.room_exists("newroom"));
    }

    #[test]
    fn test_create_room_existing() {
        let service = RoomService::new();
        let room1 = service.create_room("testroom", None).unwrap();
        let room2 = service.create_room("testroom", None).unwrap();
        // Both should return info about the same room
        assert_eq!(room1.room_key, room2.room_key);
    }

    #[test]
    fn test_create_room_with_password() {
        let service = RoomService::new();
        let result = service.create_room("secretroom", Some("password123"));
        assert!(result.is_ok());
        assert!(service.room_has_password("secretroom"));
    }

    // getRoom tests
    #[test]
    fn test_get_room_info_exists() {
        let service = RoomService::new();
        service.create_room("testroom", None).unwrap();
        let info = service.get_room_info("testroom");
        assert!(info.is_some());
    }

    #[test]
    fn test_get_room_info_nonexistent() {
        let service = RoomService::new();
        let info = service.get_room_info("nonexistent");
        assert!(info.is_none());
    }

    // joinRoom tests
    #[test]
    fn test_join_room_adds_user() {
        let service = RoomService::new();
        let result = service.join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_ok());
        let (user, users) = result.unwrap();
        assert_eq!(user.username, "TestUser");
        assert_eq!(users.len(), 1);
    }

    // joinRoomWithPassword tests
    #[test]
    fn test_join_room_with_correct_password() {
        let service = RoomService::new();
        service
            .create_room("testroom", Some("password123"))
            .unwrap();
        let result = service.join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_password("password123")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_join_room_with_wrong_password() {
        let service = RoomService::new();
        service
            .create_room("testroom", Some("password123"))
            .unwrap();
        let result = service.join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_password("wrongpass")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid password");
    }

    #[test]
    fn test_join_room_password_required() {
        let service = RoomService::new();
        service
            .create_room("testroom", Some("password123"))
            .unwrap();
        let result = service.join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Password required");
    }

    // setRoomPassword tests
    #[test]
    fn test_set_room_password() {
        let service = RoomService::new();
        service.create_room("testroom", None).unwrap();
        let result = service.set_room_password("testroom", Some("newpassword"));
        assert!(result.is_ok());
        assert!(result.unwrap());
        assert!(service.room_has_password("testroom"));
    }

    #[test]
    fn test_set_room_password_nonexistent() {
        let service = RoomService::new();
        let result = service.set_room_password("nonexistent", Some("password"));
        assert!(result.is_err());
    }

    // isRoomPasswordProtected tests
    #[test]
    fn test_room_has_password_true() {
        let service = RoomService::new();
        service
            .create_room("testroom", Some("password123"))
            .unwrap();
        assert!(service.room_has_password("testroom"));
    }

    #[test]
    fn test_room_has_password_false() {
        let service = RoomService::new();
        service.create_room("testroom", None).unwrap();
        assert!(!service.room_has_password("testroom"));
    }

    #[test]
    fn test_room_has_password_nonexistent() {
        let service = RoomService::new();
        assert!(!service.room_has_password("nonexistent"));
    }

    // leaveRoom tests
    #[test]
    fn test_leave_room_success() {
        let (service, room_key, socket_id) = create_service_with_user();
        let result = service.leave_room(&socket_id);
        assert!(result.is_some());
        let (left_room_key, _user) = result.unwrap();
        assert_eq!(left_room_key, room_key);
    }

    #[test]
    fn test_leave_room_nonexistent_socket() {
        let service = RoomService::new();
        let result = service.leave_room("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_leave_room_destroys_empty_room() {
        let (service, room_key, socket_id) = create_service_with_user();
        service.leave_room(&socket_id);
        assert!(!service.room_exists(&room_key));
    }

    // addMessage tests
    #[test]
    fn test_add_message_to_room() {
        let service = RoomService::new();
        service.create_room("testroom", None).unwrap();

        let user = User::new(
            "user1".to_string(),
            "User1".to_string(),
            "testroom".to_string(),
        );
        let message = Message {
            id: "msg1".to_string(),
            message_type: MessageType::Text,
            content: Some("Test message".to_string()),
            sender: MessageSender::from_user(&user),
            timestamp: Utc::now(),
            room_key: "testroom".to_string(),
            file_id: None,
            file_info: None,
            download_url: None,
        };

        let result = service.add_message("testroom", message);
        assert!(result.is_ok());
    }

    #[test]
    fn test_add_message_to_nonexistent_room() {
        let service = RoomService::new();
        let user = User::new(
            "user1".to_string(),
            "User1".to_string(),
            "nonexistent".to_string(),
        );
        let message = Message {
            id: "msg1".to_string(),
            message_type: MessageType::Text,
            content: Some("Test message".to_string()),
            sender: MessageSender::from_user(&user),
            timestamp: Utc::now(),
            room_key: "nonexistent".to_string(),
            file_id: None,
            file_info: None,
            download_url: None,
        };

        let result = service.add_message("nonexistent", message);
        assert!(result.is_err());
    }

    // getUsersInRoom tests
    #[test]
    fn test_get_room_users_existing() {
        let (service, room_key, _) = create_service_with_user();
        let users = service.get_room_users(&room_key);
        assert_eq!(users.len(), 1);
    }

    #[test]
    fn test_get_room_users_nonexistent() {
        let service = RoomService::new();
        let users = service.get_room_users("nonexistent");
        assert_eq!(users.len(), 0);
    }

    // getMessagesInRoom tests
    #[test]
    fn test_get_messages_existing_room() {
        let service = RoomService::new();
        service.create_room("testroom", None).unwrap();

        let user = User::new(
            "user1".to_string(),
            "User1".to_string(),
            "testroom".to_string(),
        );
        let message = Message {
            id: "msg1".to_string(),
            message_type: MessageType::Text,
            content: Some("Test".to_string()),
            sender: MessageSender::from_user(&user),
            timestamp: Utc::now(),
            room_key: "testroom".to_string(),
            file_id: None,
            file_info: None,
            download_url: None,
        };

        service.add_message("testroom", message).unwrap();
        let messages = service.get_messages("testroom");
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn test_get_messages_nonexistent_room() {
        let service = RoomService::new();
        let messages = service.get_messages("nonexistent");
        assert_eq!(messages.len(), 0);
    }

    // updateUserStatus tests
    #[test]
    fn test_update_user_status() {
        let (service, room_key, _) = create_service_with_user();
        service.update_user_status(&room_key, "user1", false);

        let users = service.get_room_users(&room_key);
        assert_eq!(users.len(), 1);
        assert!(!users[0].is_online);
    }

    // getRoomStats tests
    #[test]
    fn test_get_room_stats() {
        let service = RoomService::new();
        service
            .join_room(
                JoinRoomRequest::new("room1", "user1", "User1", "socket1").with_fingerprint("fp1"),
            )
            .unwrap();
        service
            .join_room(
                JoinRoomRequest::new("room2", "user2", "User2", "socket2").with_fingerprint("fp2"),
            )
            .unwrap();

        let stats = service.get_room_stats();
        assert_eq!(stats.total_rooms, 2);
        assert_eq!(stats.total_users, 2);
        assert_eq!(stats.online_users, 2);
    }

    // cleanupInactiveRooms tests
    #[test]
    fn test_cleanup_inactive_rooms_keeps_active() {
        let (service, room_key, _) = create_service_with_user();
        let destroyed = service.cleanup_inactive_rooms();
        assert_eq!(destroyed.len(), 0);
        assert!(service.room_exists(&room_key));
    }

    // Other existing tests
    #[test]
    fn test_set_user_offline_preserves_room() {
        let (service, room_key, socket_id) = create_service_with_user();

        let result = service.set_user_offline(&socket_id);
        assert!(result.is_some());

        assert!(service.room_exists(&room_key));

        let user = service.find_user_by_fingerprint(&room_key, "fp_hash_1");
        assert!(user.is_some());
        assert!(!user.unwrap().is_online);
    }

    #[test]
    fn test_reconnect_after_offline() {
        let (service, room_key, socket_id) = create_service_with_user();

        service.set_user_offline(&socket_id);

        let new_socket_id = "socket2";
        let result = service.join_room(
            JoinRoomRequest::new(&room_key, "user1_new", "TestUser", new_socket_id)
                .with_fingerprint("fp_hash_1"),
        );

        assert!(result.is_ok());
        let (user, users) = result.unwrap();
        assert!(user.is_online);
        assert_eq!(users.len(), 1);
    }

    #[tokio::test]
    async fn test_schedule_room_destroy_check_destroys_offline_room() {
        let (service, room_key, socket_id) = create_service_with_user();

        service.set_user_offline(&socket_id);
        assert!(service.room_exists(&room_key));

        {
            let mut rooms = service.rooms.write().unwrap();
            if let Some(room) = rooms.get(&room_key)
                && room.all_users_offline()
            {
                rooms.remove(&room_key);
            }
        }

        assert!(!service.room_exists(&room_key));
    }

    #[tokio::test]
    async fn test_schedule_room_destroy_check_preserves_online_room() {
        let (service, room_key, socket_id) = create_service_with_user();

        service.set_user_offline(&socket_id);

        service
            .join_room(
                JoinRoomRequest::new(&room_key, "user1_new", "TestUser", "socket2")
                    .with_fingerprint("fp_hash_1"),
            )
            .unwrap();

        {
            let mut rooms = service.rooms.write().unwrap();
            if let Some(room) = rooms.get(&room_key)
                && room.all_users_offline()
            {
                rooms.remove(&room_key);
            }
        }

        assert!(service.room_exists(&room_key));
    }
}
