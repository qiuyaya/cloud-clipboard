use std::collections::HashMap;
use std::sync::RwLock;
use chrono::{Duration, Utc};
use tokio::sync::broadcast;

use crate::models::{Room, User, Message};
use crate::models::room::RoomInfo;

/// Events emitted by RoomService
#[derive(Debug, Clone)]
pub enum RoomEvent {
    RoomDestroyed { room_key: String },
}

/// Service for managing rooms
pub struct RoomService {
    rooms: RwLock<HashMap<String, Room>>,
    socket_users: RwLock<HashMap<String, User>>,  // socket_id -> User
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

    /// Create a new room
    pub fn create_room(&self, room_key: &str, password: Option<&str>) -> Result<RoomInfo, String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        if rooms.contains_key(room_key) {
            return Err("Room already exists".to_string());
        }

        let password_hash = password.map(|p| {
            bcrypt::hash(p, bcrypt::DEFAULT_COST).unwrap_or_default()
        });

        let room = Room::new(room_key.to_string(), password.map(|p| p.to_string()), password_hash);
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

    /// Get room password (plaintext) for share link generation
    pub fn get_room_password(&self, room_key: &str) -> Option<String> {
        self.rooms.read()
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
    pub fn join_room(
        &self,
        room_key: &str,
        user_id: &str,
        username: &str,
        socket_id: &str,
        password: Option<&str>,
        device_type: &str,
        fingerprint: Option<&str>,
    ) -> Result<(User, Vec<User>), String> {
        let mut rooms = self.rooms.write().map_err(|_| "Lock error")?;

        // Create room if it doesn't exist
        let room = rooms.entry(room_key.to_string())
            .or_insert_with(|| Room::new(room_key.to_string(), None, None));

        // Verify password if room has one
        if room.has_password() {
            match password {
                Some(pwd) if room.verify_password(pwd) => {},
                Some(_) => return Err("Invalid password".to_string()),
                None => return Err("Password required".to_string()),
            }
        }

        // Check if user with this fingerprint already exists (reconnection)
        if let Some(fp) = fingerprint {
            if let Some(existing_user) = room.find_user_by_fingerprint(fp) {
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
                    socket_users.insert(socket_id.to_string(), user.clone());
                    user_sockets.insert(user.id.clone(), socket_id.to_string());
                }

                // Update user in room
                if let Some(u) = room.get_user_mut(&user.id) {
                    u.update_activity();
                }

                let users: Vec<User> = room.get_users().into_iter().cloned().collect();
                tracing::info!("User {} reconnected to room {} via fingerprint", user.username, room_key);
                return Ok((user, users));
            }
        }

        // Generate unique username
        let unique_username = room.generate_unique_username(username);

        // Create user
        let mut user = User::new(user_id.to_string(), unique_username, room_key.to_string());
        user.device_type = device_type.to_string();
        user.fingerprint = fingerprint.map(|f| f.to_string());
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

    /// Update user online status
    pub fn update_user_status(&self, room_key: &str, user_id: &str, is_online: bool) {
        let should_destroy = {
            let mut rooms = match self.rooms.write() {
                Ok(r) => r,
                Err(_) => return,
            };
            if let Some(room) = rooms.get_mut(room_key) {
                if let Some(u) = room.get_user_mut(user_id) {
                    if is_online {
                        u.update_activity();
                    } else {
                        u.set_offline();
                    }
                }
                // Check if room should be destroyed after status change
                if !is_online && room.all_users_offline() {
                    rooms.remove(room_key);
                    tracing::info!("Room {} destroyed (all users offline)", room_key);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };

        if should_destroy {
            let _ = self.event_sender.send(RoomEvent::RoomDestroyed {
                room_key: room_key.to_string(),
            });
        }
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
        let mut room_destroyed = false;

        {
            let mut rooms = self.rooms.write().ok()?;
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
        }

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
        let user = {
            let socket_users = self.socket_users.read().ok()?;
            socket_users.get(socket_id).cloned()?
        };

        let room_key = user.room_key.clone();

        // Use update_user_status which handles room destruction check
        self.update_user_status(&room_key, &user.id, false);

        Some((room_key, user))
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

    /// Find user by fingerprint in a room
    pub fn find_user_by_fingerprint(&self, room_key: &str, fingerprint_hash: &str) -> Option<User> {
        self.rooms.read()
            .ok()
            .and_then(|rooms| {
                rooms.get(room_key)
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
                // Destroy if inactive for 24h OR all users are offline
                let inactive = room.last_activity < cutoff;
                let all_offline = !room.is_empty() && room.all_users_offline();
                let should_keep = !inactive && !all_offline;

                if !should_keep {
                    destroyed.push(key.clone());
                    tracing::info!("Room {} destroyed (cleanup: inactive={}, all_offline={})", key, inactive, all_offline);
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
