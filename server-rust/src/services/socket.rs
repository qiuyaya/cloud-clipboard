use socketioxide::SocketIo;
use socketioxide::extract::{Data, SocketRef};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::services::RoomService;
use crate::models::Message;
use crate::utils::{generate_message_id, sanitize_message_content, detect_device_type};

/// User info for client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub is_online: bool,
    pub last_seen: chrono::DateTime<chrono::Utc>,
}

impl From<&crate::models::User> for UserInfo {
    fn from(user: &crate::models::User) -> Self {
        Self {
            id: user.id.clone(),
            name: user.username.clone(),
            device_type: user.device_type.clone(),
            is_online: user.is_online,
            last_seen: user.last_seen,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomRequest {
    pub room_key: String,
    pub user: Option<UserData>,
    pub fingerprint: Option<FingerprintData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserData {
    pub name: Option<String>,
    pub device_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintData {
    pub hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomWithPasswordRequest {
    pub room_key: String,
    pub password: String,
    pub user: Option<UserData>,
    pub fingerprint: Option<FingerprintData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRoomRequest {
    pub room_key: String,
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRoomPasswordRequest {
    pub room_key: String,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRoomLinkRequest {
    pub room_key: String,
}

#[derive(Debug, Deserialize)]
pub struct P2POfferRequest {
    #[serde(rename = "to")]
    pub target_user_id: String,
    pub offer: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct P2PAnswerRequest {
    #[serde(rename = "to")]
    pub target_user_id: String,
    pub answer: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct P2PIceCandidateRequest {
    #[serde(rename = "to")]
    pub target_user_id: String,
    pub candidate: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub room_key: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub file_type: Option<String>,
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordRequiredEvent {
    pub room_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomPasswordSetEvent {
    pub room_key: String,
    pub has_password: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomLinkGeneratedEvent {
    pub room_key: String,
    pub share_link: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PSignalEvent {
    pub from_user_id: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// System message event for broadcasting system notifications
#[derive(Debug, Serialize)]
pub struct SystemMessageEvent {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub data: serde_json::Value,
}

/// Socket-level rate limiter
struct SocketRateLimiter {
    /// socket_id -> (event_key -> RateLimitEntry)
    limits: HashMap<String, HashMap<String, RateLimitEntry>>,
}

struct RateLimitEntry {
    count: u32,
    reset_time: Instant,
}

impl SocketRateLimiter {
    fn new() -> Self {
        Self {
            limits: HashMap::new(),
        }
    }

    fn check_rate_limit(&mut self, socket_id: &str, event: &str, max_requests: u32, window_ms: u64) -> bool {
        let now = Instant::now();
        let entries = self.limits.entry(socket_id.to_string()).or_default();
        let entry = entries.entry(event.to_string()).or_insert(RateLimitEntry {
            count: 0,
            reset_time: now + std::time::Duration::from_millis(window_ms),
        });

        if now >= entry.reset_time {
            entry.count = 1;
            entry.reset_time = now + std::time::Duration::from_millis(window_ms);
            return true;
        }

        if entry.count >= max_requests {
            return false;
        }

        entry.count += 1;
        true
    }

    fn cleanup(&mut self) {
        let now = Instant::now();
        self.limits.retain(|_, entries| {
            entries.retain(|_, entry| now < entry.reset_time);
            !entries.is_empty()
        });
    }

    fn remove_socket(&mut self, socket_id: &str) {
        self.limits.remove(socket_id);
    }
}

/// Rate limit configurations matching Node.js SOCKET_RATE_LIMITS
struct SocketRateLimitConfig {
    max_requests: u32,
    window_ms: u64,
}

fn get_rate_limit_config(event: &str) -> SocketRateLimitConfig {
    match event {
        "joinRoom" | "joinRoomWithPassword" => SocketRateLimitConfig { max_requests: 5, window_ms: 60_000 },
        "leaveRoom" => SocketRateLimitConfig { max_requests: 10, window_ms: 60_000 },
        "sendMessage" => SocketRateLimitConfig { max_requests: 30, window_ms: 60_000 },
        "requestUserList" => SocketRateLimitConfig { max_requests: 20, window_ms: 60_000 },
        "setRoomPassword" => SocketRateLimitConfig { max_requests: 10, window_ms: 60_000 },
        "shareRoomLink" => SocketRateLimitConfig { max_requests: 20, window_ms: 60_000 },
        _ => SocketRateLimitConfig { max_requests: 30, window_ms: 60_000 },
    }
}

/// Setup Socket.IO event handlers
pub fn setup_socket_handlers(io: &SocketIo, room_service: Arc<RoomService>) {
    let rate_limiter = Arc::new(RwLock::new(SocketRateLimiter::new()));

    // Spawn background task to cleanup rate limit data every 5 minutes
    {
        let rate_limiter = rate_limiter.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
            loop {
                interval.tick().await;
                let mut limiter = rate_limiter.write().await;
                limiter.cleanup();
            }
        });
    }

    io.ns("/", move |socket: SocketRef| {
        let room_service = room_service.clone();
        let rate_limiter = rate_limiter.clone();

        tracing::info!("Client connected: {}", socket.id);

        // Handle join room
        socket.on("joinRoom", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<JoinRoomRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("joinRoom");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "joinRoom", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_join_room(socket, data, room_service).await;
                    } else {
                        tracing::warn!("Rate limit exceeded for joinRoom: {}", socket.id);
                        let _ = socket.emit("error", &"Too many join attempts. Please wait.");
                    }
                }
            }
        });

        // Handle join room with password
        socket.on("joinRoomWithPassword", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<JoinRoomWithPasswordRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("joinRoomWithPassword");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "joinRoomWithPassword", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_join_room_with_password(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many join attempts. Please wait.");
                    }
                }
            }
        });

        // Handle send message
        socket.on("sendMessage", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<SendMessageRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("sendMessage");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "sendMessage", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_send_message(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many messages. Please wait.");
                    }
                }
            }
        });

        // Handle leave room
        socket.on("leaveRoom", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<LeaveRoomRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("leaveRoom");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "leaveRoom", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_leave_room(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many leave attempts. Please wait.");
                    }
                }
            }
        });

        // Handle request user list
        socket.on("requestUserList", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<String>(room_key)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("requestUserList");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "requestUserList", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_request_user_list(socket, room_key, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many requests. Please wait.");
                    }
                }
            }
        });

        // Handle set room password
        socket.on("setRoomPassword", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<SetRoomPasswordRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("setRoomPassword");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "setRoomPassword", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_set_room_password(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many requests. Please wait.");
                    }
                }
            }
        });

        // Handle share room link
        socket.on("shareRoomLink", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<ShareRoomLinkRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("shareRoomLink");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(&socket.id.to_string(), "shareRoomLink", config.max_requests, config.window_ms)
                    };
                    if allowed {
                        handle_share_room_link(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many requests. Please wait.");
                    }
                }
            }
        });

        // Handle P2P offer (no rate limit, same as Node)
        socket.on("p2pOffer", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<P2POfferRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_p2p_offer(socket, data, room_service).await;
                }
            }
        });

        // Handle P2P answer (no rate limit, same as Node)
        socket.on("p2pAnswer", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<P2PAnswerRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_p2p_answer(socket, data, room_service).await;
                }
            }
        });

        // Handle P2P ICE candidate (no rate limit, same as Node)
        socket.on("p2pIceCandidate", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<P2PIceCandidateRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_p2p_ice_candidate(socket, data, room_service).await;
                }
            }
        });

        // Handle disconnect
        socket.on_disconnect({
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    // Clean up rate limiter entries for disconnected socket
                    {
                        let mut limiter = rate_limiter.write().await;
                        limiter.remove_socket(&socket.id.to_string());
                    }
                    handle_disconnect(socket, room_service).await;
                }
            }
        });
    });
}

async fn handle_join_room(
    socket: SocketRef,
    data: JoinRoomRequest,
    room_service: Arc<RoomService>,
) {
    tracing::info!("joinRoom event received: room_key={}", data.room_key);

    // Check if room requires password
    if room_service.room_has_password(&data.room_key) {
        tracing::info!("Room {} requires password", data.room_key);
        let _ = socket.emit("passwordRequired", &PasswordRequiredEvent {
            room_key: data.room_key,
        });
        return;
    }

    // Generate user ID from fingerprint or random
    let user_id = data.fingerprint
        .as_ref()
        .map(|f| format!("user_{}", &f.hash[..12.min(f.hash.len())]))
        .unwrap_or_else(crate::utils::generate_user_id);

    let username = data.user
        .as_ref()
        .and_then(|u| u.name.clone())
        .unwrap_or_else(|| {
            use rand::Rng;
            let suffix: String = rand::rng()
                .sample_iter(&rand::distr::Alphanumeric)
                .take(6)
                .map(|b| (b as char).to_ascii_lowercase())
                .collect();
            format!("用户{}", suffix)
        });

    // Detect device type: prefer client-provided value, fallback to User-Agent detection
    let device_type = data.user
        .as_ref()
        .and_then(|u| u.device_type.clone())
        .unwrap_or_else(|| {
            let req_parts = socket.req_parts();
            let ua = req_parts.headers
                .get("user-agent")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            detect_device_type(ua)
        });

    let fingerprint_hash = data.fingerprint.as_ref().map(|f| f.hash.as_str());

    let socket_id = socket.id.to_string();

    match room_service.join_room(
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        None,
        &device_type,
        fingerprint_hash,
    ) {
        Ok((user, users)) => {
            // Join socket.io room
            let _ = socket.join(data.room_key.clone());

            // Convert to client format
            let user_info = UserInfo::from(&user);
            let user_list: Vec<UserInfo> = users.iter().map(UserInfo::from).collect();

            // Send userJoined event to the joining user
            tracing::info!("Sending userJoined to socket {}: {:?}", socket.id, user_info);
            let _ = socket.emit("userJoined", &user_info);

            // Send user list
            let _ = socket.emit("userList", &user_list);

            // Send message history to joining user
            let messages = room_service.get_messages(&data.room_key);
            if !messages.is_empty() {
                let _ = socket.emit("messageHistory", &messages);
            }

            // Broadcast to others in the room
            let _ = socket.to(data.room_key.clone()).emit("userJoined", &user_info);
            let _ = socket.to(data.room_key).emit("userList", &user_list);

            tracing::info!("User {} joined room successfully", user.username);
        }
        Err(error) => {
            tracing::error!("Failed to join room: {}", error);
            let _ = socket.emit("error", &error);
        }
    }
}

async fn handle_join_room_with_password(
    socket: SocketRef,
    data: JoinRoomWithPasswordRequest,
    room_service: Arc<RoomService>,
) {
    tracing::info!("joinRoomWithPassword event received: room_key={}", data.room_key);

    // Generate user ID from fingerprint or random
    let user_id = data.fingerprint
        .as_ref()
        .map(|f| format!("user_{}", &f.hash[..12.min(f.hash.len())]))
        .unwrap_or_else(crate::utils::generate_user_id);

    let username = data.user
        .as_ref()
        .and_then(|u| u.name.clone())
        .unwrap_or_else(|| {
            use rand::Rng;
            let suffix: String = rand::rng()
                .sample_iter(&rand::distr::Alphanumeric)
                .take(6)
                .map(|b| (b as char).to_ascii_lowercase())
                .collect();
            format!("用户{}", suffix)
        });

    // Detect device type: prefer client-provided value, fallback to User-Agent detection
    let device_type = data.user
        .as_ref()
        .and_then(|u| u.device_type.clone())
        .unwrap_or_else(|| {
            let req_parts = socket.req_parts();
            let ua = req_parts.headers
                .get("user-agent")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            detect_device_type(ua)
        });

    let fingerprint_hash = data.fingerprint.as_ref().map(|f| f.hash.as_str());

    let socket_id = socket.id.to_string();

    match room_service.join_room(
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        Some(&data.password),
        &device_type,
        fingerprint_hash,
    ) {
        Ok((user, users)) => {
            // Join socket.io room
            let _ = socket.join(data.room_key.clone());

            // Convert to client format
            let user_info = UserInfo::from(&user);
            let user_list: Vec<UserInfo> = users.iter().map(UserInfo::from).collect();

            // Send userJoined event to the joining user
            let _ = socket.emit("userJoined", &user_info);
            let _ = socket.emit("userList", &user_list);

            // Send message history to joining user
            let messages = room_service.get_messages(&data.room_key);
            if !messages.is_empty() {
                let _ = socket.emit("messageHistory", &messages);
            }

            // Broadcast to others in the room
            let _ = socket.to(data.room_key.clone()).emit("userJoined", &user_info);
            let _ = socket.to(data.room_key).emit("userList", &user_list);

            tracing::info!("User {} joined password-protected room successfully", user.username);
        }
        Err(error) => {
            tracing::error!("Failed to join room with password: {}", error);
            let _ = socket.emit("error", &error);
        }
    }
}

async fn handle_send_message(
    socket: SocketRef,
    data: SendMessageRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    if let Some(user) = room_service.get_user_by_socket(&socket_id) {
        let message = if data.msg_type == "text" {
            // Sanitize text content to prevent XSS
            let sanitized_content = sanitize_message_content(&data.content.unwrap_or_default());
            Message::new_text(
                generate_message_id(),
                data.room_key.clone(),
                user.id.clone(),
                user.username.clone(),
                sanitized_content,
            )
        } else {
            Message::new_file(
                generate_message_id(),
                data.room_key.clone(),
                user.id.clone(),
                user.username.clone(),
                data.file_name.unwrap_or_default(),
                data.file_size.unwrap_or(0),
                data.file_type.unwrap_or_default(),
                data.download_url.unwrap_or_default(),
            )
        };

        if room_service.add_message(&data.room_key, message.clone()).is_ok() {
            // Broadcast message to room (including sender)
            let _ = socket.to(data.room_key.clone()).emit("message", &message);
            let _ = socket.emit("message", &message);
            tracing::debug!("Message sent in room {} by {}", data.room_key, user.username);
        }
    }
}

async fn handle_leave_room(
    socket: SocketRef,
    data: LeaveRoomRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    if let Some((room_key, _user)) = room_service.leave_room(&socket_id) {
        let _ = socket.leave(room_key.clone());

        // Broadcast user left
        let _ = socket.to(data.room_key).emit("userLeft", &data.user_id);

        tracing::info!("User {} left room {}", data.user_id, room_key);
    }
}

async fn handle_request_user_list(
    socket: SocketRef,
    room_key: String,
    room_service: Arc<RoomService>,
) {
    let users = room_service.get_room_users(&room_key);
    let user_list: Vec<UserInfo> = users.iter().map(UserInfo::from).collect();
    let _ = socket.emit("userList", &user_list);
}

async fn handle_disconnect(socket: SocketRef, room_service: Arc<RoomService>) {
    let socket_id = socket.id.to_string();
    tracing::info!("Client disconnected: {}", socket_id);

    if let Some((room_key, user)) = room_service.set_user_offline(&socket_id) {
        // Broadcast user left
        let _ = socket.to(room_key).emit("userLeft", &user.id);
    }
}

async fn handle_set_room_password(
    socket: SocketRef,
    data: SetRoomPasswordRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    // Verify user is authenticated
    let user = match room_service.get_user_by_socket(&socket_id) {
        Some(u) => u,
        None => {
            let _ = socket.emit("error", &"User not authenticated");
            return;
        }
    };

    // Verify user is in the target room
    if user.room_key != data.room_key {
        let _ = socket.emit("error", &"User not in room");
        return;
    }

    // Generate UUID password if password field is present but empty (matching Node.js behavior)
    let password = match &data.password {
        Some(pwd) if pwd.is_empty() => Some(uuid::Uuid::new_v4().to_string()),
        Some(pwd) => Some(pwd.clone()),
        None => None,
    };

    match room_service.set_room_password(&data.room_key, password.as_deref()) {
        Ok(has_password) => {
            // Broadcast to all users in the room
            let event = RoomPasswordSetEvent {
                room_key: data.room_key.clone(),
                has_password,
            };
            let _ = socket.to(data.room_key.clone()).emit("roomPasswordSet", &event);
            let _ = socket.emit("roomPasswordSet", &event);
            tracing::info!("Room {} password {} by {}", data.room_key, if has_password { "set" } else { "removed" }, user.username);
        }
        Err(error) => {
            let _ = socket.emit("error", &error);
        }
    }
}

async fn handle_share_room_link(
    socket: SocketRef,
    data: ShareRoomLinkRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    // Verify user is authenticated
    let user = match room_service.get_user_by_socket(&socket_id) {
        Some(u) => u,
        None => {
            let _ = socket.emit("error", &"User not authenticated");
            return;
        }
    };

    // Verify user is in the target room
    if user.room_key != data.room_key {
        let _ = socket.emit("error", &"User not in room");
        return;
    }

    // Verify room exists
    if !room_service.room_exists(&data.room_key) {
        let _ = socket.emit("error", &"Room not found");
        return;
    }

    // Get client origin from PUBLIC_URL or CLIENT_URL env, or socket handshake headers
    let client_origin = std::env::var("PUBLIC_URL")
        .or_else(|_| std::env::var("CLIENT_URL"))
        .ok()
        .map(|url| url.trim_end_matches('/').to_string())
        .unwrap_or_else(|| {
        let req_parts = socket.req_parts();
        let headers = &req_parts.headers;

        if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
            origin.to_string()
        } else if let Some(referer) = headers.get("referer").and_then(|v| v.to_str().ok()) {
            referer.split('?').next().unwrap_or(referer).trim_end_matches('/').to_string()
        } else {
            "http://localhost:3000".to_string()
        }
    });

    let mut share_link = format!("{}/?room={}", client_origin, data.room_key);

    // Append password if room has one
    if let Some(password) = room_service.get_room_password(&data.room_key) {
        share_link.push_str(&format!("&password={}", password));
    }

    let event = RoomLinkGeneratedEvent {
        room_key: data.room_key.clone(),
        share_link,
    };

    let _ = socket.emit("roomLinkGenerated", &event);
    tracing::info!("Share link generated for room {} by {}", data.room_key, user.username);
}

async fn handle_p2p_offer(
    socket: SocketRef,
    data: P2POfferRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    if let Some(sender) = room_service.get_user_by_socket(&socket_id) {
        // Find target user's socket
        if let Some(target_socket_id) = room_service.get_socket_by_user(&data.target_user_id) {
            let event = serde_json::json!({
                "from": sender.id,
                "offer": data.offer
            });
            let _ = socket.to(target_socket_id).emit("p2pOffer", &event);
        }
    }
}

async fn handle_p2p_answer(
    socket: SocketRef,
    data: P2PAnswerRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    if let Some(sender) = room_service.get_user_by_socket(&socket_id) {
        // Find target user's socket
        if let Some(target_socket_id) = room_service.get_socket_by_user(&data.target_user_id) {
            let event = serde_json::json!({
                "from": sender.id,
                "answer": data.answer
            });
            let _ = socket.to(target_socket_id).emit("p2pAnswer", &event);
        }
    }
}

async fn handle_p2p_ice_candidate(
    socket: SocketRef,
    data: P2PIceCandidateRequest,
    room_service: Arc<RoomService>,
) {
    let socket_id = socket.id.to_string();

    if let Some(sender) = room_service.get_user_by_socket(&socket_id) {
        // Find target user's socket
        if let Some(target_socket_id) = room_service.get_socket_by_user(&data.target_user_id) {
            let event = serde_json::json!({
                "from": sender.id,
                "candidate": data.candidate
            });
            let _ = socket.to(target_socket_id).emit("p2pIceCandidate", &event);
        }
    }
}
