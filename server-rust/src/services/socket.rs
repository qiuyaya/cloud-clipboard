use serde::{Deserialize, Serialize};
use socketioxide::SocketIo;
use socketioxide::extract::{Data, SocketRef};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::models::Message;
use crate::services::{JoinRoomRequest, RoomService};
use crate::utils::{detect_device_type, generate_message_id, sanitize_message_content};

/// User info for client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub is_online: bool,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

impl From<&crate::models::User> for UserInfo {
    fn from(user: &crate::models::User) -> Self {
        Self {
            id: user.id.clone(),
            name: user.username.clone(),
            device_type: user.device_type.clone(),
            is_online: user.is_online,
            last_seen: user.last_seen,
            fingerprint: user.fingerprint.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRoomPayload {
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
pub struct JoinRoomWithPasswordPayload {
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
#[serde(rename_all = "camelCase")]
pub struct PinRoomPayload {
    pub room_key: String,
    pub pinned: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomPinnedEvent {
    pub room_key: String,
    pub is_pinned: bool,
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
struct RecallMessageRequest {
    room_key: String,
    message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    pub room_key: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: Option<String>,
    pub file_info: Option<SendMessageFileInfo>,
    pub download_url: Option<String>,
    pub file_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageFileInfo {
    pub name: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String,
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

/// Result of join_room business logic, independent of Socket I/O
#[derive(Debug)]
pub enum JoinRoomCoreResult {
    NeedPassword { room_key: String },
    Success {
        user_info: UserInfo,
        user_list: Vec<UserInfo>,
        messages: Vec<Message>,
        has_password: bool,
        is_pinned: bool,
    },
    Error(String),
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

    fn check_rate_limit(
        &mut self,
        socket_id: &str,
        event: &str,
        max_requests: u32,
        window_ms: u64,
    ) -> bool {
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
        "joinRoom" | "joinRoomWithPassword" => SocketRateLimitConfig {
            max_requests: 15,
            window_ms: 60_000,
        },
        "leaveRoom" => SocketRateLimitConfig {
            max_requests: 20,
            window_ms: 60_000,
        },
        "sendMessage" => SocketRateLimitConfig {
            max_requests: 30,
            window_ms: 60_000,
        },
        "requestUserList" => SocketRateLimitConfig {
            max_requests: 20,
            window_ms: 60_000,
        },
        "setRoomPassword" | "pinRoom" => SocketRateLimitConfig {
            max_requests: 10,
            window_ms: 60_000,
        },
        "recallMessage" => SocketRateLimitConfig {
            max_requests: 30,
            window_ms: 60_000,
        },
        "shareRoomLink" => SocketRateLimitConfig {
            max_requests: 20,
            window_ms: 60_000,
        },
        _ => SocketRateLimitConfig {
            max_requests: 30,
            window_ms: 60_000,
        },
    }
}

/// 根据 fingerprint 决定 user_id：有 fingerprint 则生成确定性 ID，否则随机
pub fn resolve_user_id(fingerprint: Option<&FingerprintData>) -> String {
    fingerprint
        .map(|f| crate::utils::generate_user_id_from_fingerprint(&f.hash))
        .unwrap_or_else(crate::utils::generate_user_id)
}

/// 根据 user data 决定 username：有 name 则使用，否则生成随机名
pub fn resolve_username(user_data: Option<&UserData>) -> String {
    user_data
        .and_then(|u| u.name.clone())
        .unwrap_or_else(|| {
            use rand::Rng;
            let suffix: String = rand::rng()
                .sample_iter(&rand::distr::Alphanumeric)
                .take(6)
                .map(|b| (b as char).to_ascii_lowercase())
                .collect();
            format!("用户{}", suffix)
        })
}

/// 根据 user data 和 user-agent 决定 device type
pub fn resolve_device_type(user_data: Option<&UserData>, user_agent: Option<&str>) -> String {
    user_data
        .and_then(|u| u.device_type.clone())
        .unwrap_or_else(|| {
            let ua = user_agent.unwrap_or("");
            detect_device_type(ua)
        })
}

/// join_room 业务逻辑核心，不依赖 Socket I/O
pub fn join_room_core(
    room_service: &RoomService,
    room_key: &str,
    user_id: &str,
    username: &str,
    socket_id: &str,
    password: Option<&str>,
    device_type: &str,
    fingerprint: Option<&str>,
) -> JoinRoomCoreResult {
    // 如果没有提供密码且房间需要密码，返回 NeedPassword
    if password.is_none() && room_service.room_has_password(room_key) {
        return JoinRoomCoreResult::NeedPassword {
            room_key: room_key.to_string(),
        };
    }

    let join_req = JoinRoomRequest {
        room_key: room_key.to_string(),
        user_id: user_id.to_string(),
        username: username.to_string(),
        socket_id: socket_id.to_string(),
        password: password.map(|p| p.to_string()),
        device_type: device_type.to_string(),
        fingerprint: fingerprint.map(|f| f.to_string()),
    };

    match room_service.join_room(join_req) {
        Ok((user, users)) => {
            let user_info = UserInfo::from(&user);
            let user_list: Vec<UserInfo> = users.iter().map(UserInfo::from).collect();
            let messages = room_service.get_messages(room_key);
            let has_password = room_service.room_has_password(room_key);
            let is_pinned = room_service.is_room_pinned(room_key);
            JoinRoomCoreResult::Success {
                user_info,
                user_list,
                messages,
                has_password,
                is_pinned,
            }
        }
        Err(error) => JoinRoomCoreResult::Error(error),
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
            move |socket: SocketRef, Data::<JoinRoomPayload>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("joinRoom");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "joinRoom",
                            config.max_requests,
                            config.window_ms,
                        )
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
            move |socket: SocketRef, Data::<JoinRoomWithPasswordPayload>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("joinRoomWithPassword");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "joinRoomWithPassword",
                            config.max_requests,
                            config.window_ms,
                        )
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
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "sendMessage",
                            config.max_requests,
                            config.window_ms,
                        )
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
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "leaveRoom",
                            config.max_requests,
                            config.window_ms,
                        )
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
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "requestUserList",
                            config.max_requests,
                            config.window_ms,
                        )
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
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "setRoomPassword",
                            config.max_requests,
                            config.window_ms,
                        )
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
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "shareRoomLink",
                            config.max_requests,
                            config.window_ms,
                        )
                    };
                    if allowed {
                        handle_share_room_link(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many requests. Please wait.");
                    }
                }
            }
        });

        // Handle pin room
        socket.on("pinRoom", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<PinRoomPayload>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("pinRoom");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "pinRoom",
                            config.max_requests,
                            config.window_ms,
                        )
                    };
                    if allowed {
                        handle_pin_room(socket, data, room_service).await;
                    } else {
                        let _ = socket.emit("error", &"Too many requests. Please wait.");
                    }
                }
            }
        });

        // Handle recall message
        socket.on("recallMessage", {
            let room_service = room_service.clone();
            let rate_limiter = rate_limiter.clone();
            move |socket: SocketRef, Data::<RecallMessageRequest>(data)| {
                let room_service = room_service.clone();
                let rate_limiter = rate_limiter.clone();
                async move {
                    let config = get_rate_limit_config("recallMessage");
                    let allowed = {
                        let mut limiter = rate_limiter.write().await;
                        limiter.check_rate_limit(
                            &socket.id.to_string(),
                            "recallMessage",
                            config.max_requests,
                            config.window_ms,
                        )
                    };
                    if allowed {
                        handle_recall_message(socket, data, room_service).await;
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
    data: JoinRoomPayload,
    room_service: Arc<RoomService>,
) {
    tracing::info!("joinRoom event received: room_key={}", data.room_key);

    let user_id = resolve_user_id(data.fingerprint.as_ref());
    let username = resolve_username(data.user.as_ref());
    let user_agent = socket.req_parts().headers.get("user-agent").and_then(|v| v.to_str().ok());
    let device_type = resolve_device_type(data.user.as_ref(), user_agent);
    let fingerprint_hash = data.fingerprint.as_ref().map(|f| f.hash.clone());
    let socket_id = socket.id.to_string();

    match join_room_core(
        &room_service,
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        None,
        &device_type,
        fingerprint_hash.as_deref(),
    ) {
        JoinRoomCoreResult::NeedPassword { room_key } => {
            let _ = socket.emit("passwordRequired", &PasswordRequiredEvent { room_key });
        }
        JoinRoomCoreResult::Success { user_info, user_list, messages, has_password, is_pinned } => {
            let _ = socket.join(data.room_key.clone());
            let _ = socket.emit("userJoined", &user_info);
            let _ = socket.emit("userList", &user_list);
            if !messages.is_empty() {
                let _ = socket.emit("messageHistory", &messages);
            }
            let _ = socket.emit("roomPasswordSet", &RoomPasswordSetEvent { room_key: data.room_key.clone(), has_password });
            let _ = socket.emit("roomPinned", &RoomPinnedEvent { room_key: data.room_key.clone(), is_pinned });
            let _ = socket.to(data.room_key.clone()).emit("userJoined", &user_info);
            let _ = socket.to(data.room_key).emit("userList", &user_list);
            tracing::info!("User {} joined room successfully", user_info.name);
        }
        JoinRoomCoreResult::Error(error) => {
            tracing::error!("Failed to join room: {}", error);
            let _ = socket.emit("error", &error);
        }
    }
}

async fn handle_join_room_with_password(
    socket: SocketRef,
    data: JoinRoomWithPasswordPayload,
    room_service: Arc<RoomService>,
) {
    tracing::info!(
        "joinRoomWithPassword event received: room_key={}",
        data.room_key
    );

    let user_id = resolve_user_id(data.fingerprint.as_ref());
    let username = resolve_username(data.user.as_ref());
    let user_agent = socket.req_parts().headers.get("user-agent").and_then(|v| v.to_str().ok());
    let device_type = resolve_device_type(data.user.as_ref(), user_agent);
    let fingerprint_hash = data.fingerprint.as_ref().map(|f| f.hash.clone());
    let socket_id = socket.id.to_string();

    match join_room_core(
        &room_service,
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        Some(&data.password),
        &device_type,
        fingerprint_hash.as_deref(),
    ) {
        JoinRoomCoreResult::NeedPassword { .. } => {
            // 不应该到达这里，因为已经提供了密码
            let _ = socket.emit("error", &"Password required but already provided");
        }
        JoinRoomCoreResult::Success { user_info, user_list, messages, has_password, is_pinned } => {
            let _ = socket.join(data.room_key.clone());
            let _ = socket.emit("userJoined", &user_info);
            let _ = socket.emit("userList", &user_list);
            if !messages.is_empty() {
                let _ = socket.emit("messageHistory", &messages);
            }
            let _ = socket.emit("roomPasswordSet", &RoomPasswordSetEvent { room_key: data.room_key.clone(), has_password });
            let _ = socket.emit("roomPinned", &RoomPinnedEvent { room_key: data.room_key.clone(), is_pinned });
            let _ = socket.to(data.room_key.clone()).emit("userJoined", &user_info);
            let _ = socket.to(data.room_key).emit("userList", &user_list);
            tracing::info!(
                "User {} joined password-protected room successfully",
                user_info.name
            );
        }
        JoinRoomCoreResult::Error(error) => {
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
        let sender = crate::models::message::MessageSender::from_user(&user);
        let message = if data.msg_type == "text" {
            // Sanitize text content to prevent XSS
            let sanitized_content = sanitize_message_content(&data.content.unwrap_or_default());
            Message::new_text(
                generate_message_id(),
                data.room_key.clone(),
                sender,
                sanitized_content,
            )
        } else {
            let file_info = data.file_info.unwrap_or(SendMessageFileInfo {
                name: "unknown".to_string(),
                size: 0,
                file_type: "application/octet-stream".to_string(),
            });
            let mut msg = Message::new_file(
                generate_message_id(),
                data.room_key.clone(),
                sender,
                file_info.name,
                file_info.size,
                file_info.file_type,
                data.download_url.unwrap_or_default(),
            );
            msg.file_id = data.file_id;
            msg
        };

        if room_service
            .add_message(&data.room_key, message.clone())
            .is_ok()
        {
            // Broadcast message to room (including sender)
            let _ = socket.to(data.room_key.clone()).emit("message", &message);
            let _ = socket.emit("message", &message);
            tracing::debug!(
                "Message sent in room {} by {}",
                data.room_key,
                user.username
            );
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
        let _ = socket.to(room_key.clone()).emit("userLeft", &user.id);

        // Schedule delayed room destruction check to allow reconnection after browser refresh
        room_service.schedule_room_destroy_check(&room_key);
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
            let _ = socket
                .to(data.room_key.clone())
                .emit("roomPasswordSet", &event);
            let _ = socket.emit("roomPasswordSet", &event);
            tracing::info!(
                "Room {} password {} by {}",
                data.room_key,
                if has_password { "set" } else { "removed" },
                user.username
            );
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
                referer
                    .split('?')
                    .next()
                    .unwrap_or(referer)
                    .trim_end_matches('/')
                    .to_string()
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
    tracing::info!(
        "Share link generated for room {} by {}",
        data.room_key,
        user.username
    );
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
            // Verify sender and target are in the same room
            if let Some(target_user) = room_service.get_user_by_socket(&target_socket_id) {
                if sender.room_key != target_user.room_key {
                    tracing::warn!(
                        "P2P offer rejected: sender {} and target {} are in different rooms",
                        sender.id,
                        data.target_user_id
                    );
                    return;
                }
            } else {
                return;
            }
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
            // Verify sender and target are in the same room
            if let Some(target_user) = room_service.get_user_by_socket(&target_socket_id) {
                if sender.room_key != target_user.room_key {
                    tracing::warn!(
                        "P2P answer rejected: sender {} and target {} are in different rooms",
                        sender.id,
                        data.target_user_id
                    );
                    return;
                }
            } else {
                return;
            }
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
            // Verify sender and target are in the same room
            if let Some(target_user) = room_service.get_user_by_socket(&target_socket_id) {
                if sender.room_key != target_user.room_key {
                    tracing::warn!(
                        "P2P ICE candidate rejected: sender {} and target {} are in different rooms",
                        sender.id,
                        data.target_user_id
                    );
                    return;
                }
            } else {
                return;
            }
            let event = serde_json::json!({
                "from": sender.id,
                "candidate": data.candidate
            });
            let _ = socket.to(target_socket_id).emit("p2pIceCandidate", &event);
        }
    }
}

async fn handle_pin_room(socket: SocketRef, data: PinRoomPayload, room_service: Arc<RoomService>) {
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

    // Get user fingerprint
    let fingerprint = match &user.fingerprint {
        Some(fp) => fp.clone(),
        None => {
            let _ = socket.emit("error", &"User fingerprint required");
            return;
        }
    };

    let result = if data.pinned {
        room_service.pin_room(&data.room_key, &fingerprint)
    } else {
        room_service.unpin_room(&data.room_key, &fingerprint)
    };

    match result {
        Ok(is_pinned) => {
            let event = RoomPinnedEvent {
                room_key: data.room_key.clone(),
                is_pinned,
            };
            // Broadcast to all users in the room (including sender)
            let _ = socket.to(data.room_key.clone()).emit("roomPinned", &event);
            let _ = socket.emit("roomPinned", &event);
            tracing::info!(
                "Room {} {} by {}",
                data.room_key,
                if is_pinned { "pinned" } else { "unpinned" },
                user.username
            );
        }
        Err(error) => {
            tracing::error!("Failed to pin/unpin room: {}", error);
            let _ = socket.emit("error", &error.as_str());
        }
    }
}

async fn handle_recall_message(
    socket: SocketRef,
    data: RecallMessageRequest,
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

    // Verify user is the message sender (only allow recalling own messages)
    if let Some(sender_id) = room_service.get_message_sender(&data.room_key, &data.message_id) {
        if sender_id != user.id {
            let _ = socket.emit("error", &"Can only recall your own messages");
            return;
        }
    } else {
        let _ = socket.emit("error", &"Message not found");
        return;
    }

    // Remove the message
    match room_service.remove_message(&data.room_key, &data.message_id) {
        Ok(true) => {
            // Broadcast messageRecalled to all in room
            let recall_data = serde_json::json!({ "messageId": data.message_id });
            let _ = socket
                .to(data.room_key.clone())
                .emit("messageRecalled", &recall_data);
            let _ = socket.emit("messageRecalled", &recall_data);
            tracing::info!(
                "Message {} recalled in room {} by {}",
                data.message_id,
                data.room_key,
                user.username
            );
        }
        Ok(false) => {
            let _ = socket.emit("error", &"Message not found");
        }
        Err(error) => {
            let _ = socket.emit("error", &error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limit_join_room() {
        let config = get_rate_limit_config("joinRoom");
        assert_eq!(config.max_requests, 15);
        assert_eq!(config.window_ms, 60_000);
    }

    #[test]
    fn rate_limit_join_room_with_password() {
        let config = get_rate_limit_config("joinRoomWithPassword");
        assert_eq!(config.max_requests, 15);
    }

    #[test]
    fn rate_limit_leave_room() {
        let config = get_rate_limit_config("leaveRoom");
        assert_eq!(config.max_requests, 20);
    }

    #[test]
    fn rate_limit_send_message() {
        let config = get_rate_limit_config("sendMessage");
        assert_eq!(config.max_requests, 30);
    }

    #[test]
    fn rate_limit_request_user_list() {
        let config = get_rate_limit_config("requestUserList");
        assert_eq!(config.max_requests, 20);
    }

    #[test]
    fn rate_limit_set_room_password() {
        let config = get_rate_limit_config("setRoomPassword");
        assert_eq!(config.max_requests, 10);
    }

    #[test]
    fn rate_limit_pin_room() {
        let config = get_rate_limit_config("pinRoom");
        assert_eq!(config.max_requests, 10);
    }

    #[test]
    fn rate_limit_recall_message() {
        let config = get_rate_limit_config("recallMessage");
        assert_eq!(config.max_requests, 30);
    }

    #[test]
    fn rate_limit_share_room_link() {
        let config = get_rate_limit_config("shareRoomLink");
        assert_eq!(config.max_requests, 20);
    }

    #[test]
    fn rate_limit_unknown_event() {
        let config = get_rate_limit_config("unknownEvent");
        assert_eq!(config.max_requests, 30);
        assert_eq!(config.window_ms, 60_000);
    }

    #[test]
    fn user_info_from_user() {
        let now = chrono::Utc::now();
        let user = crate::models::User {
            id: "u1".to_string(),
            username: "Alice".to_string(),
            room_key: "room1".to_string(),
            is_online: true,
            last_seen: now,
            device_type: "mobile".to_string(),
            fingerprint: Some("fp1".to_string()),
        };
        let info = UserInfo::from(&user);
        assert_eq!(info.id, "u1");
        assert_eq!(info.name, "Alice");
        assert_eq!(info.device_type, "mobile");
        assert!(info.is_online);
        assert_eq!(info.fingerprint, Some("fp1".to_string()));
    }

    #[test]
    fn user_info_serialization() {
        let now = chrono::Utc::now();
        let info = UserInfo {
            id: "u1".to_string(),
            name: "Alice".to_string(),
            device_type: "desktop".to_string(),
            is_online: true,
            last_seen: now,
            fingerprint: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"name\":\"Alice\""));
        assert!(json.contains("\"isOnline\":true"));
        assert!(json.contains("\"deviceType\":\"desktop\""));
        assert!(!json.contains("fingerprint"));
    }

    #[test]
    fn socket_rate_limiter_new() {
        let limiter = SocketRateLimiter::new();
        assert!(limiter.limits.is_empty());
    }

    #[test]
    fn socket_rate_limiter_check_and_increment() {
        let mut limiter = SocketRateLimiter::new();
        let socket_id = "socket123";
        let event = "sendMessage";
        let config = get_rate_limit_config(event);

        for _ in 0..config.max_requests {
            assert!(limiter.check_rate_limit(socket_id, event, config.max_requests, config.window_ms));
        }
        // Next request should be rate limited
        assert!(!limiter.check_rate_limit(socket_id, event, config.max_requests, config.window_ms));
    }

    #[test]
    fn socket_rate_limiter_different_events_independent() {
        let mut limiter = SocketRateLimiter::new();
        let socket_id = "socket456";

        let msg_config = get_rate_limit_config("sendMessage");
        let join_config = get_rate_limit_config("joinRoom");

        // Exhaust sendMessage limit
        for _ in 0..msg_config.max_requests {
            limiter.check_rate_limit(socket_id, "sendMessage", msg_config.max_requests, msg_config.window_ms);
        }
        assert!(!limiter.check_rate_limit(socket_id, "sendMessage", msg_config.max_requests, msg_config.window_ms));

        // joinRoom should still work
        assert!(limiter.check_rate_limit(socket_id, "joinRoom", join_config.max_requests, join_config.window_ms));
    }

    #[test]
    fn socket_rate_limiter_remove_socket() {
        let mut limiter = SocketRateLimiter::new();
        let socket_id = "socket789";
        let config = get_rate_limit_config("sendMessage");

        limiter.check_rate_limit(socket_id, "sendMessage", config.max_requests, config.window_ms);
        assert!(!limiter.limits.is_empty());

        limiter.remove_socket(socket_id);
        assert!(limiter.limits.is_empty());
    }

    #[test]
    fn user_info_from_user_no_fingerprint() {
        let now = chrono::Utc::now();
        let user = crate::models::User {
            id: "u2".to_string(),
            username: "Bob".to_string(),
            room_key: "room1".to_string(),
            is_online: false,
            last_seen: now,
            device_type: "desktop".to_string(),
            fingerprint: None,
        };
        let info = UserInfo::from(&user);
        assert_eq!(info.name, "Bob");
        assert!(!info.is_online);
        assert!(info.fingerprint.is_none());
    }

    #[test]
    fn user_info_with_fingerprint_serialization() {
        let now = chrono::Utc::now();
        let info = UserInfo {
            id: "u1".to_string(),
            name: "Alice".to_string(),
            device_type: "mobile".to_string(),
            is_online: true,
            last_seen: now,
            fingerprint: Some("fp123".to_string()),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"fingerprint\":\"fp123\""));
    }

    #[test]
    fn join_room_payload_deserialize() {
        let json = r#"{"roomKey":"room1","user":{"name":"Alice","deviceType":"mobile"}}"#;
        let payload: JoinRoomPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.room_key, "room1");
        assert!(payload.user.is_some());
        assert_eq!(payload.user.unwrap().name, Some("Alice".to_string()));
    }

    #[test]
    fn join_room_payload_with_fingerprint() {
        let json = r#"{"roomKey":"room1","fingerprint":{"hash":"fp123"}}"#;
        let payload: JoinRoomPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.room_key, "room1");
        assert!(payload.fingerprint.is_some());
        assert_eq!(payload.fingerprint.unwrap().hash, "fp123");
    }

    #[test]
    fn join_room_with_password_payload_deserialize() {
        let json = r#"{"roomKey":"room1","password":"secret","user":{"name":"Alice"}}"#;
        let payload: JoinRoomWithPasswordPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.room_key, "room1");
        assert_eq!(payload.password, "secret");
    }

    #[test]
    fn send_message_request_deserialize() {
        let json = r#"{"roomKey":"room1","type":"text","content":"Hello"}"#;
        let req: SendMessageRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "room1");
        assert_eq!(req.msg_type, "text");
        assert_eq!(req.content, Some("Hello".to_string()));
    }

    #[test]
    fn send_message_request_with_file() {
        let json = r#"{"roomKey":"room1","type":"file","fileInfo":{"name":"photo.jpg","size":1024,"type":"image/jpeg"},"downloadUrl":"http://example.com/f1","fileId":"f1"}"#;
        let req: SendMessageRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.msg_type, "file");
        assert!(req.file_info.is_some());
        let fi = req.file_info.unwrap();
        assert_eq!(fi.name, "photo.jpg");
        assert_eq!(fi.size, 1024);
    }

    #[test]
    fn set_room_password_request_deserialize() {
        let json = r#"{"roomKey":"room1","password":"newpass"}"#;
        let req: SetRoomPasswordRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "room1");
        assert_eq!(req.password, Some("newpass".to_string()));
    }

    #[test]
    fn set_room_password_request_remove() {
        let json = r#"{"roomKey":"room1"}"#;
        let req: SetRoomPasswordRequest = serde_json::from_str(json).unwrap();
        assert!(req.password.is_none());
    }

    #[test]
    fn pin_room_payload_deserialize() {
        let json = r#"{"roomKey":"room1","pinned":true}"#;
        let payload: PinRoomPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.room_key, "room1");
        assert!(payload.pinned);
    }

    #[test]
    fn room_pinned_event_serialization() {
        let event = RoomPinnedEvent {
            room_key: "room1".to_string(),
            is_pinned: true,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"roomKey\":\"room1\""));
        assert!(json.contains("\"isPinned\":true"));
    }

    #[test]
    fn password_required_event_serialization() {
        let event = PasswordRequiredEvent {
            room_key: "room1".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"roomKey\":\"room1\""));
    }

    #[test]
    fn room_password_set_event_serialization() {
        let event = RoomPasswordSetEvent {
            room_key: "room1".to_string(),
            has_password: true,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"hasPassword\":true"));
    }

    #[test]
    fn room_link_generated_event_serialization() {
        let event = RoomLinkGeneratedEvent {
            room_key: "room1".to_string(),
            share_link: "https://example.com/s/abc".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"shareLink\":\"https://example.com/s/abc\""));
    }

    #[test]
    fn socket_rate_limiter_cleanup() {
        let mut limiter = SocketRateLimiter::new();
        let socket_id = "socket_cleanup";
        let config = get_rate_limit_config("sendMessage");

        limiter.check_rate_limit(socket_id, "sendMessage", config.max_requests, config.window_ms);
        assert!(!limiter.limits.is_empty());

        // Cleanup removes expired entries (but since we just added, they won't be expired yet)
        limiter.cleanup();
        // Entries should still be present since they haven't expired
        assert!(!limiter.limits.is_empty());
    }

    #[test]
    fn socket_rate_limiter_different_sockets_independent() {
        let mut limiter = SocketRateLimiter::new();
        let config = get_rate_limit_config("sendMessage");

        // Exhaust limit for socket1
        for _ in 0..config.max_requests {
            limiter.check_rate_limit("socket1", "sendMessage", config.max_requests, config.window_ms);
        }
        assert!(!limiter.check_rate_limit("socket1", "sendMessage", config.max_requests, config.window_ms));

        // socket2 should still work
        assert!(limiter.check_rate_limit("socket2", "sendMessage", config.max_requests, config.window_ms));
    }

    #[test]
    fn leave_room_request_deserialize() {
        let json = r#"{"roomKey":"room1","userId":"user1"}"#;
        let req: LeaveRoomRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "room1");
        assert_eq!(req.user_id, "user1");
    }

    #[test]
    fn share_room_link_request_deserialize() {
        let json = r#"{"roomKey":"room1"}"#;
        let req: ShareRoomLinkRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "room1");
    }

    #[test]
    fn socket_rate_limiter_window_reset() {
        let mut limiter = SocketRateLimiter::new();
        // Use a very short window (1ms) so it expires quickly
        assert!(limiter.check_rate_limit("s1", "evt", 2, 1));
        assert!(limiter.check_rate_limit("s1", "evt", 2, 1));
        assert!(!limiter.check_rate_limit("s1", "evt", 2, 1)); // rate limited
        // Wait for window to expire
        std::thread::sleep(std::time::Duration::from_millis(2));
        // Should succeed again after window reset
        assert!(limiter.check_rate_limit("s1", "evt", 2, 1));
    }

    #[test]
    fn socket_rate_limiter_cleanup_removes_expired() {
        let mut limiter = SocketRateLimiter::new();
        // Use 1ms window so entries expire immediately
        limiter.check_rate_limit("s1", "evt", 10, 1);
        // Wait for expiry
        std::thread::sleep(std::time::Duration::from_millis(2));
        limiter.cleanup();
        // After cleanup, entries should be removed
        assert!(limiter.limits.is_empty());
    }

    // --- 纯逻辑函数测试 ---

    #[test]
    fn resolve_user_id_with_fingerprint() {
        let fp = FingerprintData { hash: "abc123".to_string() };
        let id = resolve_user_id(Some(&fp));
        let id2 = resolve_user_id(Some(&fp));
        assert_eq!(id, id2);
        // UUID v5 format: deterministic for same fingerprint
        assert!(id.contains('-')); // UUID format has dashes
    }

    #[test]
    fn resolve_user_id_without_fingerprint() {
        let id = resolve_user_id(None);
        assert!(!id.is_empty());
        let id2 = resolve_user_id(None);
        assert_ne!(id, id2);
    }

    #[test]
    fn resolve_username_with_name() {
        let user_data = UserData { name: Some("Alice".to_string()), device_type: None };
        let name = resolve_username(Some(&user_data));
        assert_eq!(name, "Alice");
    }

    #[test]
    fn resolve_username_without_name() {
        let user_data = UserData { name: None, device_type: None };
        let name = resolve_username(Some(&user_data));
        assert!(name.starts_with("用户"));
        assert!(name.len() > "用户".len());
    }

    #[test]
    fn resolve_username_without_user_data() {
        let name = resolve_username(None);
        assert!(name.starts_with("用户"));
    }

    #[test]
    fn resolve_device_type_with_client_value() {
        let user_data = UserData { name: None, device_type: Some("mobile".to_string()) };
        let dt = resolve_device_type(Some(&user_data), Some("Mozilla/5.0"));
        assert_eq!(dt, "mobile");
    }

    #[test]
    fn resolve_device_type_fallback_to_user_agent() {
        let user_data = UserData { name: None, device_type: None };
        let dt = resolve_device_type(Some(&user_data), Some("Mozilla/5.0 (iPhone)"));
        assert_eq!(dt, "mobile");
    }

    #[test]
    fn resolve_device_type_no_user_agent() {
        let user_data = UserData { name: None, device_type: None };
        let dt = resolve_device_type(Some(&user_data), None);
        assert_eq!(dt, "unknown");
    }

    #[test]
    fn resolve_device_type_no_user_data_with_user_agent() {
        let dt = resolve_device_type(None, Some("Mozilla/5.0 (Linux; Android 10)"));
        assert_eq!(dt, "mobile");
    }

    #[test]
    fn resolve_device_type_no_user_data_no_user_agent() {
        let dt = resolve_device_type(None, None);
        assert_eq!(dt, "unknown");
    }

    #[test]
    fn join_room_core_password_required() {
        let room_service = RoomService::new();
        room_service.create_room("room1", Some("secret"), None).unwrap();
        let result = join_room_core(&room_service, "room1", "u1", "Alice", "s1", None, "desktop", None);
        match result {
            JoinRoomCoreResult::NeedPassword { room_key } => assert_eq!(room_key, "room1"),
            _ => panic!("Expected NeedPassword, got {:?}", result),
        }
    }

    #[test]
    fn join_room_core_success() {
        let room_service = RoomService::new();
        room_service.create_room("room1", None, None).unwrap();
        let result = join_room_core(&room_service, "room1", "u1", "Alice", "s1", None, "desktop", None);
        match result {
            JoinRoomCoreResult::Success { user_info, user_list, messages, has_password, is_pinned } => {
                assert_eq!(user_info.name, "Alice");
                assert_eq!(user_list.len(), 1);
                assert!(messages.is_empty());
                assert!(!has_password);
                assert!(!is_pinned);
            }
            _ => panic!("Expected Success, got {:?}", result),
        }
    }

    #[test]
    fn join_room_core_with_password_success() {
        let room_service = RoomService::new();
        room_service.create_room("room1", Some("secret"), None).unwrap();
        let result = join_room_core(&room_service, "room1", "u1", "Alice", "s1", Some("secret"), "desktop", None);
        match result {
            JoinRoomCoreResult::Success { user_info, has_password, .. } => {
                assert_eq!(user_info.name, "Alice");
                assert!(has_password);
            }
            _ => panic!("Expected Success, got {:?}", result),
        }
    }

    #[test]
    fn join_room_core_wrong_password() {
        let room_service = RoomService::new();
        room_service.create_room("room1", Some("secret"), None).unwrap();
        let result = join_room_core(&room_service, "room1", "u1", "Alice", "s1", Some("wrong"), "desktop", None);
        match result {
            JoinRoomCoreResult::Error(_) => {}
            _ => panic!("Expected Error, got {:?}", result),
        }
    }

    #[test]
    fn join_room_core_nonexistent_room_creates_it() {
        let room_service = RoomService::new();
        let result = join_room_core(&room_service, "newroom", "u1", "Alice", "s1", None, "desktop", None);
        match result {
            JoinRoomCoreResult::Success { .. } => {}
            _ => panic!("Expected Success, got {:?}", result),
        }
    }
}
