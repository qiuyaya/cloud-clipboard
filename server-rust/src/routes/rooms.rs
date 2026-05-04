use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::ApiResponse;
use crate::AppState;
use crate::models::Message;
use crate::utils::validate_room_key;

// ============= Request/Response Types =============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomRequest {
    pub room_key: String,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPasswordRequest {
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateUserRequest {
    pub room_key: String,
    pub user_fingerprint: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomInfoResponse {
    pub key: String,
    pub users: Vec<UserResponse>,
    pub message_count: usize,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: chrono::DateTime<chrono::Utc>,
    pub has_password: bool,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub id: String,
    pub name: String,
    pub is_online: bool,
    pub last_seen: chrono::DateTime<chrono::Utc>,
    pub device_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

impl From<&crate::models::User> for UserResponse {
    fn from(user: &crate::models::User) -> Self {
        Self {
            id: user.id.clone(),
            name: user.username.clone(),
            is_online: user.is_online,
            last_seen: user.last_seen,
            device_type: user.device_type.clone(),
            fingerprint: user.fingerprint.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomExistsData {
    pub exists: bool,
    pub has_password: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordVerifyData {
    pub valid: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateUserData {
    pub room_exists: bool,
    pub user_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<UserResponse>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStats {
    pub total_rooms: usize,
    pub total_users: usize,
    pub online_users: usize,
    pub total_messages: usize,
}

// ============= Helper Functions =============

fn extract_room_key(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-room-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn require_room_key(headers: &HeaderMap) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    let room_key = extract_room_key(headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse {
                success: false,
                message: Some("Missing x-room-key header".to_string()),
                data: None,
            }),
        )
    })?;

    if let Err(msg) = validate_room_key(&room_key) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse {
                success: false,
                message: Some(format!("Invalid room key format: {}", msg)),
                data: None,
            }),
        ));
    }

    Ok(room_key)
}

// ============= Router =============

pub fn router() -> Router<AppState> {
    Router::new()
        // 创建房间
        .route("/create", post(create_room))
        // 需要 x-room-key header 的端点
        .route("/info", get(get_room_info))
        .route("/users", get(get_room_users))
        .route("/messages", get(get_room_messages))
        // 公开端点
        .route("/stats", get(get_stats))
        .route("/validate-user", post(validate_user))
        // 路径参数端点
        .route("/{room_key}", get(get_room_by_path))
        .route("/{room_key}/exists", get(room_exists))
        .route("/{room_key}/verify-password", post(verify_password))
}

// ============= Handlers =============

/// POST /api/rooms/create
async fn create_room(
    State(state): State<AppState>,
    Json(payload): Json<CreateRoomRequest>,
) -> Result<Json<ApiResponse<RoomInfoResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    // Validate room key format
    if let Err(msg) = validate_room_key(&payload.room_key) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some(msg.to_string()),
                data: None,
            }),
        ));
    }

    match state
        .room_service
        .create_room(&payload.room_key, payload.password.as_deref(), None)
    {
        Ok(info) => {
            let response = RoomInfoResponse {
                key: info.room_key,
                users: vec![],
                message_count: 0,
                created_at: info.created_at,
                last_activity: info.last_activity,
                has_password: info.has_password,
                is_pinned: info.is_pinned,
            };
            Ok(Json(ApiResponse {
                success: true,
                message: Some("Room created successfully".to_string()),
                data: Some(response),
            }))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                message: Some(e),
                data: None,
            }),
        )),
    }
}

/// GET /api/rooms/info (requires x-room-key header)
async fn get_room_info(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<RoomInfoResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let room_key = require_room_key(&headers)?;

    let info = state.room_service.get_room_info(&room_key).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Room not found".to_string()),
                data: None,
            }),
        )
    })?;

    let users = state.room_service.get_room_users(&room_key);
    let messages = state.room_service.get_messages(&room_key);

    let response = RoomInfoResponse {
        key: info.room_key,
        users: users.iter().map(UserResponse::from).collect(),
        message_count: messages.len(),
        created_at: info.created_at,
        last_activity: info.last_activity,
        has_password: info.has_password,
        is_pinned: info.is_pinned,
    };

    Ok(Json(ApiResponse {
        success: true,
        message: None,
        data: Some(response),
    }))
}

/// GET /api/rooms/users (requires x-room-key header)
async fn get_room_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<UserResponse>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let room_key = require_room_key(&headers)?;

    let users = state.room_service.get_room_users(&room_key);
    let response: Vec<UserResponse> = users.iter().map(UserResponse::from).collect();

    Ok(Json(ApiResponse {
        success: true,
        message: None,
        data: Some(response),
    }))
}

/// GET /api/rooms/messages?limit=N (requires x-room-key header)
async fn get_room_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MessagesQuery>,
) -> Result<Json<ApiResponse<Vec<Message>>>, (StatusCode, Json<ApiResponse<()>>)> {
    let room_key = require_room_key(&headers)?;

    let mut messages = state.room_service.get_messages(&room_key);

    // Apply limit if specified
    if let Some(limit) = query.limit
        && messages.len() > limit
    {
        messages = messages.into_iter().rev().take(limit).rev().collect();
    }

    Ok(Json(ApiResponse {
        success: true,
        message: None,
        data: Some(messages),
    }))
}

/// GET /api/rooms/stats
async fn get_stats(State(state): State<AppState>) -> Json<ApiResponse<RoomStats>> {
    let stats = state.room_service.get_room_stats();

    Json(ApiResponse {
        success: true,
        message: None,
        data: Some(RoomStats {
            total_rooms: stats.total_rooms,
            total_users: stats.total_users,
            online_users: stats.online_users,
            total_messages: 0, // TODO: track total messages
        }),
    })
}

/// POST /api/rooms/validate-user
async fn validate_user(
    State(state): State<AppState>,
    Json(payload): Json<ValidateUserRequest>,
) -> Json<ApiResponse<ValidateUserData>> {
    let room_exists = state.room_service.room_exists(&payload.room_key);

    if !room_exists {
        return Json(ApiResponse {
            success: false,
            message: Some("Room not found".to_string()),
            data: Some(ValidateUserData {
                room_exists: false,
                user_exists: false,
                user: None,
            }),
        });
    }

    // Look up user by fingerprint
    let found_user = state
        .room_service
        .find_user_by_fingerprint(&payload.room_key, &payload.user_fingerprint);

    match found_user {
        Some(user) => {
            let user_response = UserResponse::from(&user);
            Json(ApiResponse {
                success: true,
                message: None,
                data: Some(ValidateUserData {
                    room_exists: true,
                    user_exists: true,
                    user: Some(user_response),
                }),
            })
        }
        None => Json(ApiResponse {
            success: true,
            message: None,
            data: Some(ValidateUserData {
                room_exists: true,
                user_exists: false,
                user: None,
            }),
        }),
    }
}

/// GET /api/rooms/:roomKey
async fn get_room_by_path(
    State(state): State<AppState>,
    Path(room_key): Path<String>,
) -> Result<Json<ApiResponse<RoomInfoResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let info = state.room_service.get_room_info(&room_key).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Room not found".to_string()),
                data: None,
            }),
        )
    })?;

    let users = state.room_service.get_room_users(&room_key);
    let messages = state.room_service.get_messages(&room_key);

    let response = RoomInfoResponse {
        key: info.room_key,
        users: users.iter().map(UserResponse::from).collect(),
        message_count: messages.len(),
        created_at: info.created_at,
        last_activity: info.last_activity,
        has_password: info.has_password,
        is_pinned: info.is_pinned,
    };

    Ok(Json(ApiResponse {
        success: true,
        message: None,
        data: Some(response),
    }))
}

/// GET /api/rooms/:roomKey/exists
async fn room_exists(
    State(state): State<AppState>,
    Path(room_key): Path<String>,
) -> Json<ApiResponse<RoomExistsData>> {
    let exists = state.room_service.room_exists(&room_key);
    let has_password = state.room_service.room_has_password(&room_key);

    Json(ApiResponse {
        success: true,
        message: None,
        data: Some(RoomExistsData {
            exists,
            has_password,
        }),
    })
}

/// POST /api/rooms/:roomKey/verify-password
async fn verify_password(
    State(state): State<AppState>,
    Path(room_key): Path<String>,
    Json(payload): Json<VerifyPasswordRequest>,
) -> Result<Json<ApiResponse<PasswordVerifyData>>, (StatusCode, Json<ApiResponse<()>>)> {
    match state
        .room_service
        .verify_room_password(&room_key, &payload.password)
    {
        Ok(valid) => Ok(Json(ApiResponse {
            success: true,
            message: None,
            data: Some(PasswordVerifyData { valid }),
        })),
        Err(e) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some(e),
                data: None,
            }),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::User;
    use chrono::Utc;

    #[test]
    fn user_response_from_user() {
        let now = Utc::now();
        let user = User {
            id: "u1".to_string(),
            username: "Alice".to_string(),
            room_key: "room1".to_string(),
            is_online: true,
            last_seen: now,
            device_type: "desktop".to_string(),
            fingerprint: Some("fp123".to_string()),
        };
        let resp = UserResponse::from(&user);
        assert_eq!(resp.id, "u1");
        assert_eq!(resp.name, "Alice");
        assert!(resp.is_online);
        assert_eq!(resp.device_type, "desktop");
        assert_eq!(resp.fingerprint, Some("fp123".to_string()));
    }

    #[test]
    fn user_response_from_user_no_fingerprint() {
        let now = Utc::now();
        let user = User {
            id: "u2".to_string(),
            username: "Bob".to_string(),
            room_key: "room2".to_string(),
            is_online: false,
            last_seen: now,
            device_type: "mobile".to_string(),
            fingerprint: None,
        };
        let resp = UserResponse::from(&user);
        assert_eq!(resp.fingerprint, None);
    }

    #[test]
    fn room_stats_serialization() {
        let stats = RoomStats {
            total_rooms: 5,
            total_users: 20,
            online_users: 8,
            total_messages: 100,
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"totalRooms\":5"));
        assert!(json.contains("\"onlineUsers\":8"));
    }

    #[test]
    fn room_exists_data_serialization() {
        let data = RoomExistsData {
            exists: true,
            has_password: false,
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"exists\":true"));
        assert!(json.contains("\"hasPassword\":false"));
    }

    #[test]
    fn password_verify_data_serialization() {
        let data = PasswordVerifyData { valid: true };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"valid\":true"));
    }

    #[test]
    fn validate_user_data_serialization() {
        let data = ValidateUserData {
            room_exists: true,
            user_exists: false,
            user: None,
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"roomExists\":true"));
        assert!(json.contains("\"userExists\":false"));
        // When user is None, it should be skipped due to skip_serializing_if
        assert!(!json.contains("\"user\":"));
    }

    #[test]
    fn validate_user_data_with_user() {
        let now = Utc::now();
        let user_resp = UserResponse {
            id: "u1".to_string(),
            name: "Alice".to_string(),
            is_online: true,
            last_seen: now,
            device_type: "desktop".to_string(),
            fingerprint: None,
        };
        let data = ValidateUserData {
            room_exists: true,
            user_exists: true,
            user: Some(user_resp),
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"userExists\":true"));
        assert!(json.contains("\"name\":\"Alice\""));
    }

    #[test]
    fn create_room_request_deserialize() {
        let json = r#"{"roomKey":"test123","password":"secret"}"#;
        let req: CreateRoomRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "test123");
        assert_eq!(req.password, Some("secret".to_string()));
    }

    #[test]
    fn create_room_request_no_password() {
        let json = r#"{"roomKey":"test456"}"#;
        let req: CreateRoomRequest = serde_json::from_str(json).unwrap();
        assert!(req.password.is_none());
    }

    #[test]
    fn verify_password_request_deserialize() {
        let json = r#"{"password":"mypass"}"#;
        let req: VerifyPasswordRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.password, "mypass");
    }

    #[test]
    fn validate_user_request_deserialize() {
        let json = r#"{"roomKey":"room1","userFingerprint":"fp123"}"#;
        let req: ValidateUserRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.room_key, "room1");
        assert_eq!(req.user_fingerprint, "fp123");
    }

    #[test]
    fn messages_query_deserialize() {
        let json = r#"{"limit":50}"#;
        let q: MessagesQuery = serde_json::from_str(json).unwrap();
        assert_eq!(q.limit, Some(50));
    }

    #[test]
    fn messages_query_no_limit() {
        let json = r#"{}"#;
        let q: MessagesQuery = serde_json::from_str(json).unwrap();
        assert!(q.limit.is_none());
    }

    #[test]
    fn room_info_response_serialization() {
        let now = Utc::now();
        let resp = RoomInfoResponse {
            key: "room1".to_string(),
            users: vec![],
            message_count: 5,
            created_at: now,
            last_activity: now,
            has_password: true,
            is_pinned: false,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"key\":\"room1\""));
        assert!(json.contains("\"hasPassword\":true"));
        assert!(json.contains("\"isPinned\":false"));
    }

    #[test]
    fn extract_room_key_from_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-room-key", "myroom".parse().unwrap());
        assert_eq!(extract_room_key(&headers), Some("myroom".to_string()));
    }

    #[test]
    fn extract_room_key_missing() {
        let headers = HeaderMap::new();
        assert_eq!(extract_room_key(&headers), None);
    }

    #[test]
    fn require_room_key_valid() {
        let mut headers = HeaderMap::new();
        headers.insert("x-room-key", "room1a".parse().unwrap());
        let result = require_room_key(&headers);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "room1a");
    }

    #[test]
    fn require_room_key_missing() {
        let headers = HeaderMap::new();
        let result = require_room_key(&headers);
        assert!(result.is_err());
        let (status, json) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!json.success);
    }

    #[test]
    fn require_room_key_invalid_format() {
        let mut headers = HeaderMap::new();
        headers.insert("x-room-key", "ab".parse().unwrap()); // too short
        let result = require_room_key(&headers);
        assert!(result.is_err());
        let (status, json) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(!json.success);
    }
}
