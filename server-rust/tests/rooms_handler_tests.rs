use axum::body::Body;
use axum::http::{Request, StatusCode};
use cloud_clipboard_server::models::message::MessageSender;
use cloud_clipboard_server::models::room::RoomInfo;
use cloud_clipboard_server::models::*;
use cloud_clipboard_server::routes::rooms::router;
use cloud_clipboard_server::services::room_service::RoomStats;
use cloud_clipboard_server::services::traits::*;
use http_body_util::BodyExt;
use serde::Deserialize;
use std::sync::Arc;
use tower::ServiceExt;

mod common;

use common::mocks::{MockFileManager, MockRoomService, MockShareService};
use common::test_app::create_test_app_state;

// ============= Response Types for Deserialization =============

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse<T: Default> {
    success: bool,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomInfoData {
    #[serde(default)]
    key: String,
    #[serde(default)]
    users: Vec<serde_json::Value>,
    #[serde(default)]
    message_count: usize,
    #[serde(default)]
    has_password: bool,
    #[serde(default)]
    is_pinned: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomExistsData {
    #[serde(default)]
    exists: bool,
    #[serde(default)]
    has_password: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordVerifyData {
    #[serde(default)]
    valid: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateUserData {
    #[serde(default)]
    room_exists: bool,
    #[serde(default)]
    user_exists: bool,
    #[serde(default)]
    user: Option<serde_json::Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoomStatsData {
    #[serde(default)]
    total_rooms: usize,
    #[serde(default)]
    total_users: usize,
    #[serde(default)]
    online_users: usize,
    #[serde(default)]
    total_messages: usize,
}

// ============= Helper Functions =============

fn create_app() -> axum::Router<()> {
    let room_service = Arc::new(MockRoomService::new());
    let file_manager = Arc::new(MockFileManager::new());
    let share_service = Arc::new(MockShareService::new());
    let state = create_test_app_state(
        room_service as Arc<dyn RoomServiceTrait>,
        file_manager as Arc<dyn FileManagerTrait>,
        share_service as Arc<dyn ShareServiceTrait>,
    );
    router().with_state(state)
}

fn create_app_with_mock() -> (axum::Router<()>, Arc<MockRoomService>) {
    let room_service = Arc::new(MockRoomService::new());
    let file_manager = Arc::new(MockFileManager::new());
    let share_service = Arc::new(MockShareService::new());
    let state = create_test_app_state(
        room_service.clone() as Arc<dyn RoomServiceTrait>,
        file_manager as Arc<dyn FileManagerTrait>,
        share_service as Arc<dyn ShareServiceTrait>,
    );
    (router().with_state(state), room_service)
}

fn make_room_info(room_key: &str) -> RoomInfo {
    RoomInfo {
        room_key: room_key.to_string(),
        user_count: 0,
        has_password: false,
        created_at: chrono::Utc::now(),
        last_activity: chrono::Utc::now(),
        is_pinned: false,
    }
}

async fn read_body(body: Body) -> Vec<u8> {
    body.collect().await.unwrap().to_bytes().to_vec()
}

// ============= create_room Tests =============

#[tokio::test]
async fn test_create_room_success() {
    let app = create_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/create")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"test1234"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().key, "test1234");
}

#[tokio::test]
async fn test_create_room_invalid_key_pure_numbers() {
    let app = create_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/create")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"123456"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("letters and numbers"));
}

#[tokio::test]
async fn test_create_room_already_exists() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/create")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"test1234"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // MockRoomService returns Err("Room already exists") for duplicate keys,
    // which the handler maps to 500 INTERNAL_SERVER_ERROR
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("already exists"));
}

// ============= get_room_info Tests =============

#[tokio::test]
async fn test_get_room_info_success() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/info")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().key, "test1234");
}

#[tokio::test]
async fn test_get_room_info_not_found() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/info")
                .header("x-room-key", "nonexist1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("not found"));
}

#[tokio::test]
async fn test_get_room_info_missing_header() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Missing"));
}

// ============= get_room_users Tests =============

#[tokio::test]
async fn test_get_room_users_success() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/users")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    // MockRoomService returns empty user list
    assert_eq!(parsed.data.unwrap().len(), 0);
}

// ============= get_room_messages Tests =============

#[tokio::test]
async fn test_get_room_messages_success() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/messages")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    // MockRoomService returns empty message list
    assert_eq!(parsed.data.unwrap().len(), 0);
}

// ============= room_exists Tests =============

#[tokio::test]
async fn test_room_exists_true() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test1234/exists")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomExistsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(data.exists);
}

#[tokio::test]
async fn test_room_exists_false() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/nonexist1/exists")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomExistsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(!data.exists);
}

// ============= verify_password Tests =============

#[tokio::test]
async fn test_verify_password() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/test1234/verify-password")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"secret123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<PasswordVerifyData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    // MockRoomService returns Ok(false) by default for verify_room_password
    assert!(!parsed.data.unwrap().valid);
}

// ============= verify_password: correct password =============

#[tokio::test]
async fn test_verify_password_correct() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_verify_password_result(Ok(true));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/test1234/verify-password")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"correct"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<PasswordVerifyData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert!(parsed.data.unwrap().valid);
}

// ============= verify_password: room not found =============

#[tokio::test]
async fn test_verify_password_room_not_found() {
    let (app, mock) = create_app_with_mock();
    mock.set_verify_password_result(Err("Room not found".to_string()));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/nonexist1/verify-password")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"password":"any"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("not found"));
}

// ============= get_room_by_path: success =============

#[tokio::test]
async fn test_get_room_by_path_success() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().key, "test1234");
}

// ============= get_room_by_path: not found =============

#[tokio::test]
async fn test_get_room_by_path_not_found() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/nonexist1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("not found"));
}

// ============= get_room_by_path: with users and messages =============

#[tokio::test]
async fn test_get_room_by_path_with_users_and_messages() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_room_users(
        "test1234",
        vec![User::new("u1".to_string(), "Alice".to_string(), "test1234".to_string())],
    );
    mock.set_messages(
        "test1234",
        vec![Message::new_text(
            "m1".to_string(),
            "test1234".to_string(),
            MessageSender::system(),
            "Hello".to_string(),
        )],
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert_eq!(data.key, "test1234");
    assert_eq!(data.users.len(), 1);
    assert_eq!(data.message_count, 1);
}

// ============= room_exists: room with password =============

#[tokio::test]
async fn test_room_exists_with_password() {
    let (app, mock) = create_app_with_mock();
    let mut info = make_room_info("test1234");
    info.has_password = true;
    mock.add_room("test1234", info);
    mock.set_room_has_password("test1234", true);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test1234/exists")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomExistsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(data.exists);
    assert!(data.has_password);
}

// ============= get_room_messages: with messages =============

#[tokio::test]
async fn test_get_room_messages_with_messages() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_messages(
        "test1234",
        vec![
            Message::new_text(
                "m1".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Hello".to_string(),
            ),
            Message::new_text(
                "m2".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "World".to_string(),
            ),
        ],
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/messages")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().len(), 2);
}

// ============= get_room_messages: with limit smaller than message count =============

#[tokio::test]
async fn test_get_room_messages_with_limit() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_messages(
        "test1234",
        vec![
            Message::new_text(
                "m1".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "First".to_string(),
            ),
            Message::new_text(
                "m2".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Second".to_string(),
            ),
            Message::new_text(
                "m3".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Third".to_string(),
            ),
            Message::new_text(
                "m4".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Fourth".to_string(),
            ),
            Message::new_text(
                "m5".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Fifth".to_string(),
            ),
        ],
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/messages?limit=2")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let messages = parsed.data.unwrap();
    // Should return the last 2 messages (most recent ones)
    assert_eq!(messages.len(), 2);
}

// ============= get_room_messages: with limit larger than message count =============

#[tokio::test]
async fn test_get_room_messages_limit_larger_than_count() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_messages(
        "test1234",
        vec![Message::new_text(
            "m1".to_string(),
            "test1234".to_string(),
            MessageSender::system(),
            "Only one".to_string(),
        )],
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/messages?limit=100")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    // limit > message count, should return all messages without truncation
    assert_eq!(parsed.data.unwrap().len(), 1);
}

// ============= get_room_messages: missing x-room-key header =============

#[tokio::test]
async fn test_get_room_messages_missing_header() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/messages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ============= get_room_info: with users and messages =============

#[tokio::test]
async fn test_get_room_info_with_users_and_messages() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    mock.set_room_users(
        "test1234",
        vec![
            User::new("u1".to_string(), "Alice".to_string(), "test1234".to_string()),
            User::new("u2".to_string(), "Bob".to_string(), "test1234".to_string()),
        ],
    );
    mock.set_messages(
        "test1234",
        vec![
            Message::new_text(
                "m1".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "Hello".to_string(),
            ),
            Message::new_text(
                "m2".to_string(),
                "test1234".to_string(),
                MessageSender::system(),
                "World".to_string(),
            ),
        ],
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/info")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert_eq!(data.key, "test1234");
    assert_eq!(data.users.len(), 2);
    assert_eq!(data.message_count, 2);
}

// ============= get_room_users: with users =============

#[tokio::test]
async fn test_get_room_users_with_users() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    let user1 = User::new("u1".to_string(), "Alice".to_string(), "test1234".to_string());
    let user2 = User::new("u2".to_string(), "Bob".to_string(), "test1234".to_string());
    mock.set_room_users("test1234", vec![user1, user2]);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/users")
                .header("x-room-key", "test1234")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<serde_json::Value>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let users = parsed.data.unwrap();
    assert_eq!(users.len(), 2);
    // Verify user data is present
    assert!(users[0].get("id").is_some());
    assert!(users[1].get("id").is_some());
}

// ============= get_room_users: missing header =============

#[tokio::test]
async fn test_get_room_users_missing_header() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/users")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ============= validate_user: room not found =============

#[tokio::test]
async fn test_validate_user_room_not_found() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/validate-user")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"nonexist1","userFingerprint":"fp123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ValidateUserData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    let data = parsed.data.unwrap();
    assert!(!data.room_exists);
    assert!(!data.user_exists);
    assert!(data.user.is_none());
}

// ============= validate_user: room exists but user not found =============

#[tokio::test]
async fn test_validate_user_room_exists_user_not_found() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/validate-user")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"test1234","userFingerprint":"fp_unknown"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ValidateUserData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(data.room_exists);
    assert!(!data.user_exists);
    assert!(data.user.is_none());
}

// ============= validate_user: room exists and user found =============

#[tokio::test]
async fn test_validate_user_room_exists_user_found() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    let user = User::new("u1".to_string(), "Alice".to_string(), "test1234".to_string());
    mock.set_find_user("fp123", user);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/validate-user")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"test1234","userFingerprint":"fp123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ValidateUserData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(data.room_exists);
    assert!(data.user_exists);
    assert!(data.user.is_some());
    let user_data = data.user.unwrap();
    assert_eq!(user_data.get("id").unwrap().as_str().unwrap(), "u1");
    assert_eq!(user_data.get("name").unwrap().as_str().unwrap(), "Alice");
}

// ============= get_stats: success =============

#[tokio::test]
async fn test_get_stats_success() {
    let (app, mock) = create_app_with_mock();
    mock.set_room_stats(RoomStats {
        total_rooms: 3,
        total_users: 10,
        online_users: 5,
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomStatsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert_eq!(data.total_rooms, 3);
    assert_eq!(data.total_users, 10);
    assert_eq!(data.online_users, 5);
    // total_messages is hardcoded to 0 (TODO in rooms.rs)
    assert_eq!(data.total_messages, 0);
}

// ============= get_stats: default empty =============

#[tokio::test]
async fn test_get_stats_default() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/stats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomStatsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert_eq!(data.total_rooms, 0);
    assert_eq!(data.total_users, 0);
    assert_eq!(data.online_users, 0);
}

// ============= get_room_info: invalid room key format =============

#[tokio::test]
async fn test_get_room_info_invalid_key_format() {
    let app = create_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/info")
                .header("x-room-key", "ab") // too short, invalid format
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid room key format"));
}

// ============= create_room: with password =============

#[tokio::test]
async fn test_create_room_with_password() {
    let (app, _mock) = create_app_with_mock();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/create")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"roomKey":"test1234","password":"secret123"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().key, "test1234");
}

// ============= room_exists: room without password =============

#[tokio::test]
async fn test_room_exists_without_password() {
    let (app, mock) = create_app_with_mock();
    mock.add_room("test1234", make_room_info("test1234"));
    // Default has_password is false

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/test1234/exists")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<RoomExistsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let data = parsed.data.unwrap();
    assert!(data.exists);
    assert!(!data.has_password);
}
