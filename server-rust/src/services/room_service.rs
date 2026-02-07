use std::collections::HashMap;
use std::sync::RwLock;
use chrono::{Duration, Utc};

use crate::models::{Room, User, Message};
use crate::models::room::RoomInfo;

/// Service for managing rooms
pub struct RoomService {
    rooms: RwLock<HashMap<String, Room>>,
    socket_users: RwLock<HashMap<String, User>>,  // socket_id -> User
    user_sockets: RwLock<HashMap<String, String>>, // user_id -> socket_id
}

impl RoomService {
    pub fn new() -> Self {
        Self {
            rooms: RwLock::new(HashMap::new()),
            socket_users: RwLock::new(HashMap::new()),
            user_sockets: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new room
    pub fn create_room(&self, room_key: &str, password: Option<&str>) -> Result<RoomInfo, String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        if rooms.contains_key(room_key) {
            return Err("Room already exists".to_string());
        }

        let password_hash = password.map(|p| {
            bcrypt::hash(p, bcrypt::DEFAULT_COST).unwrap_or_default()
        });

        let room = Room::new(room_key.to_string(), password_hash);
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
        self.rooms.read()
            .map(|rooms| rooms.contains_key(room_key))
            .unwrap_or(false)
    }

    /// Check if room has password
    pub fn room_has_password(&self, room_key: &str) -> bool {
        self.rooms.read()
            .ok()
            .and_then(|rooms| rooms.get(room_key).map(|r| r.has_password()))
            .unwrap_or(false)
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
    pub fn join_room(
        &self,
        room_key: &str,
        user_id: &str,
        username: &str,
        socket_id: &str,
        password: Option<&str>,
    ) -> Result<(User, Vec<User>), String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        // Create room if it doesn't exist
        let room = rooms.entry(room_key.to_string())
            .or_insert_with(|| Room::new(room_key.to_string(), None));

        // Verify password if room has one
        if room.has_password() {
            match password {
                Some(pwd) if room.verify_password(pwd) => {},
                Some(_) => return Err("Invalid password".to_string()),
                None => return Err("Password required".to_string()),
            }
        }

        // Generate unique username
        let unique_username = room.generate_unique_username(username);

        // Create user
        let user = User::new(user_id.to_string(), unique_username, room_key.to_string());
        room.add_user(user.clone());

        // Track socket mapping
        {
            let mut socket_users = self.socket_users.write().map_err(|_| "Lock error")?;
            let mut user_sockets = self.user_sockets.write().map_err(|_| "Lock error")?;
            socket_users.insert(socket_id.to_string(), user.clone());
            user_sockets.insert(user_id.to_string(), socket_id.to_string());
        }

        let users: Vec<User> = room.get_users().into_iter().cloned().collect();

        tracing::info!("User {} joined room {}", user.username, room_key);
        Ok((user, users))
    }

    /// Leave a room
    pub fn leave_room(&self, socket_id: &str) -> Option<(String, User)> {
        let user = {
            let mut socket_users = self.socket_users.write().ok()?;
            socket_users.remove(socket_id)?
        };

        {
            let mut user_sockets = self.user_sockets.write().ok()?;
            user_sockets.remove(&user.id);
        }

        let room_key = user.room_key.clone();

        {
            let mut rooms = self.rooms.write().ok()?;
            if let Some(room) = rooms.get_mut(&room_key) {
                room.remove_user(&user.id);

                // Check if room should be destroyed
                if room.is_empty() || room.all_users_offline() {
                    let key = room_key.clone();
                    rooms.remove(&key);
                    tracing::info!("Room {} destroyed (empty)", key);
                }
            }
        }

        tracing::info!("User {} left room {}", user.username, room_key);
        Some((room_key, user))
    }

    /// Set user offline (disconnect without removing)
    pub fn set_user_offline(&self, socket_id: &str) -> Option<(String, User)> {
        let user = {
            let socket_users = self.socket_users.read().ok()?;
            socket_users.get(socket_id).cloned()?
        };

        {
            let mut rooms = self.rooms.write().ok()?;
            if let Some(room) = rooms.get_mut(&user.room_key) {
                if let Some(u) = room.get_user_mut(&user.id) {
                    u.set_offline();
                }
            }
        }

        Some((user.room_key.clone(), user))
    }

    /// Get users in a room
    pub fn get_room_users(&self, room_key: &str) -> Vec<User> {
        self.rooms.read()
            .map(|rooms| {
                rooms.get(room_key)
                    .map(|r| r.get_users().into_iter().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
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
        self.rooms.read()
            .map(|rooms| {
                rooms.get(room_key)
                    .map(|r| r.get_messages().to_vec())
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
    pub fn set_room_password(&self, room_key: &str, password: Option<&str>) -> Result<bool, String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;
        match rooms.get_mut(room_key) {
            Some(room) => {
                if let Some(pwd) = password {
                    let hash = bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
                    room.password_hash = Some(hash);
                    Ok(true)
                } else {
                    room.password_hash = None;
                    Ok(false)
                }
            }
            None => Err("Room not found".to_string()),
        }
    }

    /// Get room statistics
    pub fn get_room_stats(&self) -> RoomStats {
        let rooms = self.rooms.read().unwrap();
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
                let should_keep = room.last_activity > cutoff || !room.all_users_offline();
                if !should_keep {
                    destroyed.push(key.clone());
                    tracing::info!("Room {} destroyed (inactive)", key);
                }
                should_keep
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
