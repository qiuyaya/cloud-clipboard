use socketioxide::SocketIo;
use socketioxide::extract::{Data, SocketRef};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::services::RoomService;
use crate::models::Message;
use crate::utils::generate_message_id;

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
            device_type: "desktop".to_string(),
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
#[serde(rename_all = "camelCase")]
pub struct P2POfferRequest {
    pub target_user_id: String,
    pub offer: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PAnswerRequest {
    pub target_user_id: String,
    pub answer: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PIceCandidateRequest {
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
    pub share_url: String,
    pub expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PSignalEvent {
    pub from_user_id: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Setup Socket.IO event handlers
pub fn setup_socket_handlers(io: &SocketIo, room_service: Arc<RoomService>) {
    io.ns("/", move |socket: SocketRef| {
        let room_service = room_service.clone();

        tracing::info!("Client connected: {}", socket.id);

        // Handle join room
        socket.on("joinRoom", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<JoinRoomRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_join_room(socket, data, room_service).await;
                }
            }
        });

        // Handle join room with password
        socket.on("joinRoomWithPassword", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<JoinRoomWithPasswordRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_join_room_with_password(socket, data, room_service).await;
                }
            }
        });

        // Handle send message
        socket.on("sendMessage", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<SendMessageRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_send_message(socket, data, room_service).await;
                }
            }
        });

        // Handle leave room
        socket.on("leaveRoom", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<LeaveRoomRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_leave_room(socket, data, room_service).await;
                }
            }
        });

        // Handle request user list
        socket.on("requestUserList", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<String>(room_key)| {
                let room_service = room_service.clone();
                async move {
                    handle_request_user_list(socket, room_key, room_service).await;
                }
            }
        });

        // Handle set room password
        socket.on("setRoomPassword", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<SetRoomPasswordRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_set_room_password(socket, data, room_service).await;
                }
            }
        });

        // Handle share room link
        socket.on("shareRoomLink", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<ShareRoomLinkRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_share_room_link(socket, data, room_service).await;
                }
            }
        });

        // Handle P2P offer
        socket.on("p2pOffer", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<P2POfferRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_p2p_offer(socket, data, room_service).await;
                }
            }
        });

        // Handle P2P answer
        socket.on("p2pAnswer", {
            let room_service = room_service.clone();
            move |socket: SocketRef, Data::<P2PAnswerRequest>(data)| {
                let room_service = room_service.clone();
                async move {
                    handle_p2p_answer(socket, data, room_service).await;
                }
            }
        });

        // Handle P2P ICE candidate
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
            move |socket: SocketRef| {
                let room_service = room_service.clone();
                async move {
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
        .unwrap_or_else(|| format!("User_{}", &user_id[5..11]));

    let socket_id = socket.id.to_string();

    match room_service.join_room(
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        None,
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
        .unwrap_or_else(|| format!("User_{}", &user_id[5..11]));

    let socket_id = socket.id.to_string();

    match room_service.join_room(
        &data.room_key,
        &user_id,
        &username,
        &socket_id,
        Some(&data.password),
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
            Message::new_text(
                generate_message_id(),
                data.room_key.clone(),
                user.id.clone(),
                user.username.clone(),
                data.content.unwrap_or_default(),
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
    match room_service.set_room_password(&data.room_key, data.password.as_deref()) {
        Ok(has_password) => {
            // Broadcast to all users in the room
            let event = RoomPasswordSetEvent {
                room_key: data.room_key.clone(),
                has_password,
            };
            let _ = socket.to(data.room_key.clone()).emit("roomPasswordSet", &event);
            let _ = socket.emit("roomPasswordSet", &event);
            tracing::info!("Room {} password {}", data.room_key, if has_password { "set" } else { "removed" });
        }
        Err(error) => {
            let _ = socket.emit("error", &error);
        }
    }
}

async fn handle_share_room_link(
    socket: SocketRef,
    data: ShareRoomLinkRequest,
    _room_service: Arc<RoomService>,
) {
    // Generate a simple share URL (in real implementation, this would create a proper share link)
    let share_url = format!("/join/{}", data.room_key);

    let event = RoomLinkGeneratedEvent {
        room_key: data.room_key.clone(),
        share_url,
        expires_at: None,
    };

    let _ = socket.emit("roomLinkGenerated", &event);
    tracing::info!("Share link generated for room {}", data.room_key);
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
                "fromUserId": sender.id,
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
                "fromUserId": sender.id,
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
                "fromUserId": sender.id,
                "candidate": data.candidate
            });
            let _ = socket.to(target_socket_id).emit("p2pIceCandidate", &event);
        }
    }
}
