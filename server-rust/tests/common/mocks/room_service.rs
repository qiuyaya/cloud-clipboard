use cloud_clipboard_server::models::room::RoomInfo;
use cloud_clipboard_server::models::*;
use cloud_clipboard_server::services::room_service::{JoinRoomRequest, RoomEvent, RoomStats};
use cloud_clipboard_server::services::traits::RoomServiceTrait;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::broadcast;

#[derive(Debug, Clone)]
pub struct RoomServiceCall {
    pub method: String,
    pub room_key: Option<String>,
}

pub struct MockRoomService {
    calls: Mutex<Vec<RoomServiceCall>>,
    rooms: Mutex<HashMap<String, RoomInfo>>,
    event_sender: broadcast::Sender<RoomEvent>,
    create_room_result: Mutex<Option<Result<RoomInfo, String>>>,
    join_room_result: Mutex<Option<Result<(User, Vec<User>), String>>>,
    // Configurable mock data for advanced testing
    messages: Mutex<HashMap<String, Vec<Message>>>,
    users: Mutex<HashMap<String, Vec<User>>>,
    verify_password_result: Mutex<Option<Result<bool, String>>>,
    find_user_result: Mutex<HashMap<String, User>>,
    room_has_password_map: Mutex<HashMap<String, bool>>,
    room_stats: Mutex<Option<RoomStats>>,
}

impl MockRoomService {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(16);
        Self {
            calls: Mutex::new(Vec::new()),
            rooms: Mutex::new(HashMap::new()),
            event_sender: tx,
            create_room_result: Mutex::new(None),
            join_room_result: Mutex::new(None),
            messages: Mutex::new(HashMap::new()),
            users: Mutex::new(HashMap::new()),
            verify_password_result: Mutex::new(None),
            find_user_result: Mutex::new(HashMap::new()),
            room_has_password_map: Mutex::new(HashMap::new()),
            room_stats: Mutex::new(None),
        }
    }

    pub fn add_room(&self, room_key: &str, info: RoomInfo) {
        self.rooms
            .lock()
            .unwrap()
            .insert(room_key.to_string(), info);
    }

    pub fn set_create_room_result(&self, result: Result<RoomInfo, String>) {
        *self.create_room_result.lock().unwrap() = Some(result);
    }

    pub fn set_join_room_result(&self, result: Result<(User, Vec<User>), String>) {
        *self.join_room_result.lock().unwrap() = Some(result);
    }

    /// Set messages for a specific room
    pub fn set_messages(&self, room_key: &str, messages: Vec<Message>) {
        self.messages
            .lock()
            .unwrap()
            .insert(room_key.to_string(), messages);
    }

    /// Set users for a specific room
    pub fn set_room_users(&self, room_key: &str, users: Vec<User>) {
        self.users
            .lock()
            .unwrap()
            .insert(room_key.to_string(), users);
    }

    /// Set the result for verify_room_password (overrides default Ok(false))
    pub fn set_verify_password_result(&self, result: Result<bool, String>) {
        *self.verify_password_result.lock().unwrap() = Some(result);
    }

    /// Set a user to be found by fingerprint
    pub fn set_find_user(&self, fingerprint: &str, user: User) {
        self.find_user_result
            .lock()
            .unwrap()
            .insert(fingerprint.to_string(), user);
    }

    /// Set has_password for a specific room
    pub fn set_room_has_password(&self, room_key: &str, has_password: bool) {
        self.room_has_password_map
            .lock()
            .unwrap()
            .insert(room_key.to_string(), has_password);
    }

    /// Set room stats
    pub fn set_room_stats(&self, stats: RoomStats) {
        *self.room_stats.lock().unwrap() = Some(stats);
    }

    pub fn get_calls(&self) -> Vec<RoomServiceCall> {
        self.calls.lock().unwrap().clone()
    }

    fn record_call(&self, method: &str, room_key: Option<&str>) {
        self.calls.lock().unwrap().push(RoomServiceCall {
            method: method.to_string(),
            room_key: room_key.map(|s| s.to_string()),
        });
    }
}

impl RoomServiceTrait for MockRoomService {
    fn create_room(
        &self,
        room_key: &str,
        _password: Option<&str>,
        _creator_fingerprint: Option<&str>,
    ) -> Result<RoomInfo, String> {
        self.record_call("create_room", Some(room_key));
        if let Some(result) = self.create_room_result.lock().unwrap().take() {
            return result;
        }
        let mut rooms = self.rooms.lock().unwrap();
        if rooms.contains_key(room_key) {
            Err("Room already exists".to_string())
        } else {
            let info = RoomInfo {
                room_key: room_key.to_string(),
                user_count: 0,
                has_password: false,
                created_at: chrono::Utc::now(),
                last_activity: chrono::Utc::now(),
                is_pinned: false,
            };
            rooms.insert(room_key.to_string(), info.clone());
            Ok(info)
        }
    }

    fn get_room_info(&self, room_key: &str) -> Option<RoomInfo> {
        self.record_call("get_room_info", Some(room_key));
        self.rooms.lock().unwrap().get(room_key).cloned()
    }

    fn room_exists(&self, room_key: &str) -> bool {
        self.record_call("room_exists", Some(room_key));
        self.rooms.lock().unwrap().contains_key(room_key)
    }

    fn room_has_password(&self, room_key: &str) -> bool {
        self.room_has_password_map
            .lock()
            .unwrap()
            .get(room_key)
            .copied()
            .unwrap_or(false)
    }

    fn get_room_password(&self, _room_key: &str) -> Option<String> {
        None
    }

    fn verify_room_password(&self, room_key: &str, _password: &str) -> Result<bool, String> {
        self.record_call("verify_room_password", Some(room_key));
        if let Some(result) = self.verify_password_result.lock().unwrap().take() {
            return result;
        }
        Ok(false)
    }

    fn join_room(&self, _req: JoinRoomRequest) -> Result<(User, Vec<User>), String> {
        self.record_call("join_room", None);
        if let Some(result) = self.join_room_result.lock().unwrap().take() {
            return result;
        }
        Err("Not implemented".to_string())
    }

    fn get_room_users(&self, room_key: &str) -> Vec<User> {
        self.users
            .lock()
            .unwrap()
            .get(room_key)
            .cloned()
            .unwrap_or_default()
    }

    fn get_messages(&self, room_key: &str) -> Vec<Message> {
        self.messages
            .lock()
            .unwrap()
            .get(room_key)
            .cloned()
            .unwrap_or_default()
    }

    fn find_user_by_fingerprint(&self, _room_key: &str, fingerprint_hash: &str) -> Option<User> {
        self.find_user_result
            .lock()
            .unwrap()
            .get(fingerprint_hash)
            .cloned()
    }

    fn get_room_stats(&self) -> RoomStats {
        self.room_stats
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(RoomStats {
                total_rooms: 0,
                total_users: 0,
                online_users: 0,
            })
    }

    fn add_message(&self, _room_key: &str, _message: Message) -> Result<(), String> {
        Ok(())
    }

    fn remove_message(&self, _room_key: &str, _message_id: &str) -> Result<bool, String> {
        Ok(false)
    }

    fn get_message_sender(&self, _room_key: &str, _message_id: &str) -> Option<String> {
        None
    }

    fn get_user_by_socket(&self, _socket_id: &str) -> Option<User> {
        None
    }

    fn get_socket_by_user(&self, _user_id: &str) -> Option<String> {
        None
    }

    fn set_room_password(
        &self,
        _room_key: &str,
        _password: Option<&str>,
    ) -> Result<bool, String> {
        Ok(true)
    }

    fn pin_room(&self, _room_key: &str, _fingerprint: &str) -> Result<bool, String> {
        Ok(true)
    }

    fn unpin_room(&self, _room_key: &str, _fingerprint: &str) -> Result<bool, String> {
        Ok(true)
    }

    fn is_room_pinned(&self, _room_key: &str) -> bool {
        false
    }

    fn update_user_status(&self, _room_key: &str, _user_id: &str, _is_online: bool) {}

    fn leave_room(&self, _socket_id: &str) -> Option<(String, User)> {
        None
    }

    fn set_user_offline(&self, _socket_id: &str) -> Option<(String, User)> {
        None
    }

    fn subscribe(&self) -> broadcast::Receiver<RoomEvent> {
        self.event_sender.subscribe()
    }

    fn cleanup_inactive_rooms(&self) -> Vec<String> {
        vec![]
    }
}
