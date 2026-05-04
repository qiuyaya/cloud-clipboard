/// Share Handler Integration Tests
///
/// Tests for share-related HTTP endpoints using mock services:
/// - POST /api/share (create share)
/// - GET /api/share (list shares)
/// - GET /api/share/:shareId (get share)
/// - DELETE /api/share/:shareId (delete/revoke share)
/// - GET /api/share/:shareId/access (access logs)
/// - GET /api/share/user/:userId (user shares)
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::routing::get;
use base64::Engine;
use chrono::Utc;
use cloud_clipboard_server::models::share::{ShareAccessLog, ShareInfo, ShareInfoParams};
use cloud_clipboard_server::routes::share::{public_download, router};
use cloud_clipboard_server::services::file_manager::FileInfo;
use cloud_clipboard_server::services::traits::*;
use http_body_util::BodyExt;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use tower::ServiceExt;

mod common;

use common::mocks::{MockFileManager, MockRoomService, MockShareService};
use common::test_app::create_test_app_state;

// ============= Response Types for Deserialization =============

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ApiResponse<T: Default> {
    success: bool,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct CreateShareData {
    #[serde(default)]
    share_id: String,
    #[serde(default)]
    file_id: String,
    #[serde(default)]
    created_by: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    expires_at: String,
    #[serde(default)]
    has_password: bool,
    #[serde(default)]
    access_count: u64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ShareListData {
    #[serde(default)]
    shares: Vec<ShareListItemData>,
    #[serde(default)]
    total: usize,
    #[serde(default)]
    limit: usize,
    #[serde(default)]
    offset: usize,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ShareListItemData {
    #[serde(default)]
    share_id: String,
    #[serde(default)]
    original_filename: String,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    expires_at: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    access_count: u64,
    #[serde(default)]
    has_password: bool,
    #[serde(default)]
    url: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ShareInfoData {
    #[serde(default)]
    share_id: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    expires_at: String,
    #[serde(default)]
    is_active: bool,
    #[serde(default)]
    is_expired: bool,
    #[serde(default)]
    has_password: bool,
    #[serde(default)]
    access_count: u64,
    #[serde(default)]
    created_by: String,
    #[serde(default)]
    last_accessed_at: Option<String>,
    #[serde(default)]
    status: String,
}

#[derive(Debug, Default, Deserialize)]
#[allow(dead_code)]
struct AccessLogsData {
    #[serde(default)]
    logs: Vec<serde_json::Value>,
    #[serde(default)]
    total: usize,
}

// ============= Test Context =============

#[allow(dead_code)]
struct TestContext {
    room_service: Arc<MockRoomService>,
    file_manager: Arc<MockFileManager>,
    share_service: Arc<MockShareService>,
    state: cloud_clipboard_server::AppState,
}

impl TestContext {
    fn new() -> Self {
        let _ = cloud_clipboard_server::config::init_config();

        let room_service = Arc::new(MockRoomService::new());
        let file_manager = Arc::new(MockFileManager::new());
        let share_service = Arc::new(MockShareService::new());

        let state = create_test_app_state(
            room_service.clone() as Arc<dyn RoomServiceTrait>,
            file_manager.clone() as Arc<dyn FileManagerTrait>,
            share_service.clone() as Arc<dyn ShareServiceTrait>,
        );

        Self {
            room_service,
            file_manager,
            share_service,
            state,
        }
    }

    fn app(&self) -> axum::Router<()> {
        router().with_state(self.state.clone())
    }
}

async fn read_body(body: Body) -> Vec<u8> {
    body.collect().await.unwrap().to_bytes().to_vec()
}

/// Helper: create a ShareInfo suitable for adding to MockShareService
fn make_share_info(
    share_id: &str,
    file_name: &str,
    room_key: &str,
    created_by: &str,
    expires_in_days: i64,
    with_password: bool,
) -> ShareInfo {
    let password_hash = if with_password {
        Some(bcrypt::hash("testpass", bcrypt::DEFAULT_COST).unwrap())
    } else {
        None
    };
    ShareInfo::new(ShareInfoParams {
        share_id: share_id.to_string(),
        file_path: format!("/uploads/{}", file_name),
        file_name: file_name.to_string(),
        file_size: 1024,
        room_key: room_key.to_string(),
        created_by: created_by.to_string(),
        expires_in_days,
        password_hash,
        metadata: None,
    })
}

/// Helper: create a FileInfo suitable for adding to MockFileManager
fn make_file_info(filename: &str, room_key: &str, original_name: &str, size: u64) -> FileInfo {
    FileInfo {
        filename: filename.to_string(),
        original_name: original_name.to_string(),
        size,
        mime_type: "application/octet-stream".to_string(),
        room_key: room_key.to_string(),
        uploaded_at: Utc::now(),
        path: PathBuf::from(format!("/uploads/{}", filename)),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    }
}

// ============= create_share Tests =============

#[tokio::test]
async fn test_create_share_without_password() {
    let ctx = TestContext::new();

    // Add a file to MockFileManager so create_share can find it
    ctx.file_manager.add_file(
        "file-001",
        make_file_info("file-001", "room1", "document.pdf", 2048),
    );

    // Pre-set the create_share result
    let share = make_share_info("share001", "document.pdf", "room1", "user1", 7, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-001",
        "expiresInDays": 7
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<CreateShareData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.message.as_deref(), Some("Share link created successfully"));

    let data = parsed.data.unwrap();
    assert_eq!(data.share_id, "share001");
    assert_eq!(data.file_id, "file-001");
    assert!(!data.has_password);
    assert!(data.password.is_none());
    assert!(data.url.contains("/public/file/share001"));
}

#[tokio::test]
async fn test_create_share_with_password() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-002",
        make_file_info("file-002", "room1", "secret.zip", 4096),
    );

    let share = make_share_info("share002", "secret.zip", "room1", "user1", 7, true);
    ctx.share_service
        .set_create_share_result(Ok((share, Some("abc123".to_string()))));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-002",
        "expiresInDays": 7,
        "password": "somepassword"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<CreateShareData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.share_id, "share002");
    assert!(data.has_password);
    assert_eq!(data.password.as_deref(), Some("abc123"));
    // URL should contain password query param
    assert!(data.url.contains("password="));
}

#[tokio::test]
async fn test_create_share_expiration_zero_days() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-003",
        "expiresInDays": 0
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("1-30 days"));
}

#[tokio::test]
async fn test_create_share_expiration_31_days() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-004",
        "expiresInDays": 31
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("1-30 days"));
}

#[tokio::test]
async fn test_create_share_file_not_found() {
    let ctx = TestContext::new();

    // No file added to MockFileManager, so get_file returns None
    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "nonexistent-file",
        "expiresInDays": 7
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("File not found"));
}

// ============= list_shares Tests =============

#[tokio::test]
async fn test_list_shares_empty() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert!(data.shares.is_empty());
    assert_eq!(data.total, 0);
}

#[tokio::test]
async fn test_list_shares_with_status_filter() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?status=active")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert!(data.shares.is_empty());
}

// ============= get_share Tests =============

#[tokio::test]
async fn test_get_share_not_found() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/nonexistent-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

// ============= delete_share Tests =============

#[tokio::test]
async fn test_delete_share_not_found() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/nonexistent-id")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_delete_share_missing_user_id() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/some-share-id")
                // No x-user-id header
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("User ID required"));
}

#[tokio::test]
async fn test_delete_share_wrong_owner() {
    let ctx = TestContext::new();

    // Add a share owned by user1
    let share = make_share_info("share003", "doc.txt", "room1", "user1", 7, false);
    ctx.share_service.add_share("share003", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/share003")
                .header("x-user-id", "user2") // Different user
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("permission"));
}

// ============= get_access_logs Tests =============

#[tokio::test]
async fn test_get_access_logs_empty() {
    let ctx = TestContext::new();

    // Add a share so the endpoint does not return 404
    let share = make_share_info("share004", "notes.txt", "room1", "user1", 7, false);
    ctx.share_service.add_share("share004", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/share004/access")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<AccessLogsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert!(data.logs.is_empty());
    assert_eq!(data.total, 0);
}

#[tokio::test]
async fn test_get_access_logs_share_not_found() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/nonexistent-id/access")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
}

// ============= get_user_shares Tests =============

#[tokio::test]
async fn test_get_user_shares_empty() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/user/test-user")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<ShareInfoData>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert!(data.is_empty());
}

// ============= permanent_delete Tests =============

#[tokio::test]
async fn test_permanent_delete_not_found() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/nonexistent-id/permanent-delete")
                .header("x-user-id", "user1")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

// ============= Extended Tests for Coverage =============

// --- create_share extended ---

#[tokio::test]
async fn test_create_share_service_error() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-err",
        make_file_info("file-err", "room1", "error.pdf", 1024),
    );

    ctx.share_service
        .set_create_share_result(Err("Internal service error".to_string()));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-err",
        "expiresInDays": 7
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Internal service error"));
}

#[tokio::test]
async fn test_create_share_default_expiration() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-default-exp",
        make_file_info("file-default-exp", "room1", "doc.pdf", 512),
    );

    let share = make_share_info("shareDefExp", "doc.pdf", "room1", "user1", 7, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    // No expiresInDays field - should default to 7
    let body = serde_json::json!({
        "fileId": "file-default-exp"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_create_share_no_user_id_header() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-no-user",
        make_file_info("file-no-user", "room1", "anon.pdf", 256),
    );

    let share = make_share_info("shareAnon", "anon.pdf", "room1", "temp-user-id", 7, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-no-user",
        "expiresInDays": 7
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                // No x-user-id header - should fallback to "temp-user-id"
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<CreateShareData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
}

#[tokio::test]
async fn test_create_share_empty_password() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-empty-pwd",
        make_file_info("file-empty-pwd", "room1", "nopwd.pdf", 256),
    );

    // When password is empty string, enable_password should be false
    let share = make_share_info("shareEmptyPwd", "nopwd.pdf", "room1", "user1", 7, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-empty-pwd",
        "expiresInDays": 7,
        "password": ""
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_create_share_expiration_1_day() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-1day",
        make_file_info("file-1day", "room1", "oneday.pdf", 128),
    );

    let share = make_share_info("share1Day", "oneday.pdf", "room1", "user1", 1, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-1day",
        "expiresInDays": 1
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_create_share_expiration_30_days() {
    let ctx = TestContext::new();

    ctx.file_manager.add_file(
        "file-30day",
        make_file_info("file-30day", "room1", "thirty.pdf", 128),
    );

    let share = make_share_info("share30Day", "thirty.pdf", "room1", "user1", 30, false);
    ctx.share_service
        .set_create_share_result(Ok((share, None)));

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-30day",
        "expiresInDays": 30
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_create_share_negative_expiration() {
    let ctx = TestContext::new();

    let app = ctx.app();
    let body = serde_json::json!({
        "fileId": "file-neg",
        "expiresInDays": -1
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/")
                .header("content-type", "application/json")
                .header("x-user-id", "user1")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("1-30 days"));
}

// --- list_shares extended ---

#[tokio::test]
async fn test_list_shares_with_active_data() {
    let ctx = TestContext::new();

    // Add shares owned by user1
    let share = make_share_info("shareActive", "doc.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareActive", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?status=active")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 1);
    assert_eq!(data.shares[0].share_id, "shareActive");
    assert_eq!(data.shares[0].status, "active");
}

#[tokio::test]
async fn test_list_shares_with_expired_filter() {
    let ctx = TestContext::new();

    // Add an expired share (expires_in_days = -1 creates an already-expired share)
    let share = make_share_info("shareExpired", "old.pdf", "room1", "user1", -1, false);
    ctx.share_service.add_share("shareExpired", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?status=expired")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 1);
    assert_eq!(data.shares[0].status, "expired");
}

#[tokio::test]
async fn test_list_shares_with_all_status() {
    let ctx = TestContext::new();

    let share = make_share_info("shareAll", "doc.pdf", "room1", "user1", 7, true);
    ctx.share_service.add_share("shareAll", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?status=all")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 1);
    assert!(data.shares[0].has_password);
}

#[tokio::test]
async fn test_list_shares_pagination() {
    let ctx = TestContext::new();

    // Add multiple shares
    for i in 0..5 {
        let id = format!("sharePage{}", i);
        let share = make_share_info(&id, &format!("file{}.pdf", i), "room1", "user1", 7, false);
        ctx.share_service.add_share(&id, share);
    }

    let app = ctx.app();
    // Get first 2 shares with offset 0
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?limit=2&offset=0")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 2);
    assert_eq!(data.total, 5);
    assert_eq!(data.limit, 2);
    assert_eq!(data.offset, 0);
}

#[tokio::test]
async fn test_list_shares_user_id_from_query() {
    let ctx = TestContext::new();

    let share = make_share_info("shareQueryUser", "q.pdf", "room1", "user-query", 7, false);
    ctx.share_service.add_share("shareQueryUser", share);

    let app = ctx.app();
    // Use user_id from query parameter instead of header
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?userId=user-query")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 1);
}

#[tokio::test]
async fn test_list_shares_unknown_status_filter() {
    let ctx = TestContext::new();

    let share = make_share_info("shareUnknown", "doc.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareUnknown", share);

    let app = ctx.app();
    // Unknown status filter should return all (matches _ => true branch)
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/?status=unknown_status")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareListData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.shares.len(), 1);
}

// --- get_share extended ---

#[tokio::test]
async fn test_get_share_success() {
    let ctx = TestContext::new();

    let share = make_share_info("shareGetOk", "info.pdf", "room1", "user1", 7, true);
    ctx.share_service.add_share("shareGetOk", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/shareGetOk")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<ShareInfoData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.share_id, "shareGetOk");
    assert!(data.has_password);
}

// --- delete_share extended ---

#[tokio::test]
async fn test_delete_share_success() {
    let ctx = TestContext::new();

    let share = make_share_info("shareDelOk", "del.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareDelOk", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/shareDelOk")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.message.as_deref(), Some("Share revoked"));
}

#[tokio::test]
async fn test_delete_share_revoke_returns_false() {
    let ctx = TestContext::new();

    let share = make_share_info("shareRevokeFalse", "doc.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareRevokeFalse", share);

    ctx.share_service.set_revoke_share_result(Ok(false));

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/shareRevokeFalse")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_delete_share_revoke_error() {
    let ctx = TestContext::new();

    let share = make_share_info("shareRevokeErr", "doc.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareRevokeErr", share);

    ctx.share_service
        .set_revoke_share_result(Err("Database error".to_string()));

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/shareRevokeErr")
                .header("x-user-id", "user1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Database error"));
}

// --- permanent_delete extended ---

#[tokio::test]
async fn test_permanent_delete_success() {
    let ctx = TestContext::new();

    let share = make_share_info("sharePermDelOk", "perm.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("sharePermDelOk", share);

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermDelOk/permanent-delete")
                .header("x-user-id", "user1")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.message.as_deref(), Some("Share permanently deleted"));
}

#[tokio::test]
async fn test_permanent_delete_wrong_owner() {
    let ctx = TestContext::new();

    let share = make_share_info("sharePermDelWrong", "perm.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("sharePermDelWrong", share);

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermDelWrong/permanent-delete")
                .header("x-user-id", "other-user")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("permission"));
}

#[tokio::test]
async fn test_permanent_delete_returns_none() {
    let ctx = TestContext::new();

    let share = make_share_info("sharePermDelNone", "perm.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("sharePermDelNone", share);

    // delete_share returns Ok(None) -> "Share not found"
    ctx.share_service.set_delete_share_result(Ok(None));

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermDelNone/permanent-delete")
                .header("x-user-id", "user1")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_permanent_delete_error() {
    let ctx = TestContext::new();

    let share = make_share_info("sharePermDelErr", "perm.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("sharePermDelErr", share);

    ctx.share_service
        .set_delete_share_result(Err("Storage error".to_string()));

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermDelErr/permanent-delete")
                .header("x-user-id", "user1")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Storage error"));
}

#[tokio::test]
async fn test_permanent_delete_user_id_from_body() {
    let ctx = TestContext::new();

    let share = make_share_info("sharePermDelBody", "perm.pdf", "room1", "body-user", 7, false);
    ctx.share_service.add_share("sharePermDelBody", share);

    let app = ctx.app();
    // No x-user-id header, but user_id in request body
    let body = serde_json::json!({
        "userId": "body-user"
    });
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermDelBody/permanent-delete")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
}

#[tokio::test]
async fn test_permanent_delete_no_user_id_fallback() {
    let ctx = TestContext::new();

    // Neither header nor body provides user_id -> falls back to "temp-user-id"
    let share = make_share_info("sharePermNoUser", "perm.pdf", "room1", "temp-user-id", 7, false);
    ctx.share_service.add_share("sharePermNoUser", share);

    let app = ctx.app();
    let body = serde_json::json!({});
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sharePermNoUser/permanent-delete")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should succeed since temp-user-id matches created_by
    assert_eq!(response.status(), StatusCode::OK);
}

// --- get_access_logs extended ---

#[tokio::test]
async fn test_get_access_logs_with_data() {
    let ctx = TestContext::new();

    let share = make_share_info("shareWithLogs", "log.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("shareWithLogs", share);

    let log = ShareAccessLog {
        timestamp: Utc::now(),
        ip_address: "1.2.3.4".to_string(),
        user_agent: Some("TestBrowser".to_string()),
        success: true,
        bytes_transferred: Some(1024),
        error_message: None,
    };
    ctx.share_service.add_access_logs("shareWithLogs", vec![log]);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/shareWithLogs/access")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<AccessLogsData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.logs.len(), 1);
    assert_eq!(data.total, 1);
}

// --- get_user_shares extended ---

#[tokio::test]
async fn test_get_user_shares_with_data() {
    let ctx = TestContext::new();

    let share = make_share_info("shareUserList", "list.pdf", "room1", "target-user", 7, true);
    ctx.share_service.add_share("shareUserList", share);

    let app = ctx.app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/user/target-user")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<Vec<ShareInfoData>> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    let data = parsed.data.unwrap();
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].share_id, "shareUserList");
    assert!(data[0].has_password);
}

// ============= public_download Tests =============

// public_download already imported at the top of the file

/// Test context that includes a public_download router
struct DownloadTestContext {
    file_manager: Arc<MockFileManager>,
    share_service: Arc<MockShareService>,
    state: cloud_clipboard_server::AppState,
}

impl DownloadTestContext {
    fn new() -> Self {
        let _ = cloud_clipboard_server::config::init_config();

        let room_service = Arc::new(MockRoomService::new());
        let file_manager = Arc::new(MockFileManager::new());
        let share_service = Arc::new(MockShareService::new());

        let state = create_test_app_state(
            room_service.clone() as Arc<dyn RoomServiceTrait>,
            file_manager.clone() as Arc<dyn FileManagerTrait>,
            share_service.clone() as Arc<dyn ShareServiceTrait>,
        );

        Self {
            file_manager,
            share_service,
            state,
        }
    }

    fn download_app(&self) -> axum::Router<()> {
        axum::Router::new()
            .route("/{share_id}", get(public_download))
            .with_state(self.state.clone())
    }
}

/// Create a valid share ID (8-10 alphanumeric characters)
fn valid_share_id(id: &str) -> String {
    // Pad or truncate to 8-10 chars
    if id.len() >= 8 && id.len() <= 10 && id.chars().all(|c| c.is_ascii_alphanumeric()) {
        id.to_string()
    } else {
        format!("sh{:05}", id.len().min(99999))
    }
}

#[tokio::test]
async fn test_public_download_invalid_share_id_too_short() {
    let ctx = DownloadTestContext::new();
    let app = ctx.download_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/abc123") // 6 chars - too short
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid share ID format"));
}

#[tokio::test]
async fn test_public_download_invalid_share_id_too_long() {
    let ctx = DownloadTestContext::new();
    let app = ctx.download_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/abcdefghijk") // 11 chars - too long
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid share ID format"));
}

#[tokio::test]
async fn test_public_download_invalid_share_id_special_chars() {
    let ctx = DownloadTestContext::new();
    let app = ctx.download_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/abc-def!") // special chars
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid share ID format"));
}

#[tokio::test]
async fn test_public_download_share_not_found() {
    let ctx = DownloadTestContext::new();
    let app = ctx.download_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/abcd1234") // valid format but doesn't exist
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_public_download_expired_share() {
    let ctx = DownloadTestContext::new();

    // Create an expired share (negative days)
    let share = make_share_info("expired01", "old.pdf", "room1", "user1", -1, false);
    ctx.share_service.add_share("expired01", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/expired01")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_public_download_inactive_share() {
    let ctx = DownloadTestContext::new();

    // Create a share with is_active = false
    let mut share = make_share_info("inactive1", "doc.pdf", "room1", "user1", 7, false);
    share.is_active = false;
    ctx.share_service.add_share("inactive1", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/inactive1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Share not found"));
}

#[tokio::test]
async fn test_public_download_password_protected_no_password() {
    let ctx = DownloadTestContext::new();

    let share = make_share_info("pwdShare1", "secret.pdf", "room1", "user1", 7, true);
    ctx.share_service.add_share("pwdShare1", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/pwdShare1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Should include WWW-Authenticate header (check before consuming body)
    let www_auth = response
        .headers()
        .get("WWW-Authenticate")
        .expect("Should have WWW-Authenticate header");
    assert!(www_auth.to_str().unwrap().contains("Basic"));

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Password required"));
}

#[tokio::test]
async fn test_public_download_password_protected_wrong_password_query() {
    let ctx = DownloadTestContext::new();

    // make_share_info uses "testpass" as password
    let share = make_share_info("pwdShare2", "secret.pdf", "room1", "user1", 7, true);
    ctx.share_service.add_share("pwdShare2", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/pwdShare2?password=wrongpass")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid password"));

    // Verify access was recorded as failed
    let calls = ctx.share_service.get_record_access_calls();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].success);
    assert_eq!(calls[0].error.as_deref(), Some("Invalid password"));
}

#[tokio::test]
async fn test_public_download_password_protected_wrong_password_basic_auth() {
    let ctx = DownloadTestContext::new();

    let share = make_share_info("pwdShare3", "secret.pdf", "room1", "user1", 7, true);
    ctx.share_service.add_share("pwdShare3", share);

    let app = ctx.download_app();
    // Basic Auth with wrong password
    let encoded = base64::engine::general_purpose::STANDARD.encode(":wrongpass");
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/pwdShare3")
                .header("authorization", format!("Basic {}", encoded))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid password"));
}

#[tokio::test]
async fn test_public_download_file_not_found() {
    let ctx = DownloadTestContext::new();

    // Share exists, is active, not expired, no password - but file not in file_manager
    let share = make_share_info("noFile01", "missing.pdf", "room1", "user1", 7, false);
    ctx.share_service.add_share("noFile01", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/noFile01")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("File not found"));
}

#[tokio::test]
async fn test_public_download_success_with_temp_file() {
    let ctx = DownloadTestContext::new();

    // Create a temporary file for download
    let upload_dir = std::env::temp_dir().join("cloud-clipboard-test-uploads");
    std::fs::create_dir_all(&upload_dir).ok();
    let test_file_path = upload_dir.join("testdownload.pdf");
    std::fs::write(&test_file_path, b"test file content for download").unwrap();

    // Add file to mock file manager
    let file_info = FileInfo {
        filename: "testdownload.pdf".to_string(),
        original_name: "Test Document.pdf".to_string(),
        size: 30,
        mime_type: "application/pdf".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: test_file_path.clone(),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("testdownload.pdf", file_info);

    // Add share pointing to this file
    let mut share = make_share_info("dlShare01", "testdownload.pdf", "room1", "user1", 7, false);
    share.file_name = "testdownload.pdf".to_string();
    ctx.share_service.add_share("dlShare01", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/dlShare01")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify content disposition header
    let content_disp = response
        .headers()
        .get("content-disposition")
        .expect("Should have content-disposition header");
    let disp_str = content_disp.to_str().unwrap();
    assert!(disp_str.contains("attachment"));
    // Without metadata, falls back to file_name
    assert!(disp_str.contains("testdownload.pdf"));

    // Verify content type
    let content_type = response
        .headers()
        .get("content-type")
        .expect("Should have content-type header");
    assert_eq!(content_type.to_str().unwrap(), "application/pdf");

    // Verify cache control
    let cache_ctrl = response
        .headers()
        .get("cache-control")
        .expect("Should have cache-control header");
    assert!(cache_ctrl.to_str().unwrap().contains("no-store"));

    // Verify x-content-type-options
    let x_content_type = response
        .headers()
        .get("x-content-type-options")
        .expect("Should have x-content-type-options header");
    assert_eq!(x_content_type.to_str().unwrap(), "nosniff");

    // Verify access was recorded as successful
    let calls = ctx.share_service.get_record_access_calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].success);
    assert_eq!(calls[0].bytes, Some(30));

    // Cleanup
    std::fs::remove_file(&test_file_path).ok();
}

#[tokio::test]
async fn test_public_download_password_protected_correct_password_query() {
    let ctx = DownloadTestContext::new();

    // Create temp file
    let upload_dir = std::env::temp_dir().join("cloud-clipboard-test-uploads");
    std::fs::create_dir_all(&upload_dir).ok();
    let test_file_path = upload_dir.join("pwddownload.zip");
    std::fs::write(&test_file_path, b"secret file content").unwrap();

    let file_info = FileInfo {
        filename: "pwddownload.zip".to_string(),
        original_name: "Secret Archive.zip".to_string(),
        size: 19,
        mime_type: "application/zip".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: test_file_path.clone(),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("pwddownload.zip", file_info);

    // make_share_info with password uses "testpass"
    let mut share = make_share_info("pwdDl001", "pwddownload.zip", "room1", "user1", 7, true);
    share.file_name = "pwddownload.zip".to_string();
    ctx.share_service.add_share("pwdDl001", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/pwdDl001?password=testpass")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Cleanup
    std::fs::remove_file(&test_file_path).ok();
}

#[tokio::test]
async fn test_public_download_password_protected_correct_password_basic_auth() {
    let ctx = DownloadTestContext::new();

    // Create temp file
    let upload_dir = std::env::temp_dir().join("cloud-clipboard-test-uploads");
    std::fs::create_dir_all(&upload_dir).ok();
    let test_file_path = upload_dir.join("basicdownload.pdf");
    std::fs::write(&test_file_path, b"basic auth content").unwrap();

    let file_info = FileInfo {
        filename: "basicdownload.pdf".to_string(),
        original_name: "BasicAuth.pdf".to_string(),
        size: 18,
        mime_type: "application/pdf".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: test_file_path.clone(),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("basicdownload.pdf", file_info);

    let mut share = make_share_info("basicDl1", "basicdownload.pdf", "room1", "user1", 7, true);
    share.file_name = "basicdownload.pdf".to_string();
    ctx.share_service.add_share("basicDl1", share);

    let app = ctx.download_app();
    // Basic Auth: base64(":testpass")
    let encoded = base64::engine::general_purpose::STANDARD.encode(":testpass");
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/basicDl1")
                .header("authorization", format!("Basic {}", encoded))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Cleanup
    std::fs::remove_file(&test_file_path).ok();
}

#[tokio::test]
async fn test_public_download_symlink_rejected() {
    let ctx = DownloadTestContext::new();

    let upload_dir = std::env::temp_dir().join("cloud-clipboard-test-uploads");
    std::fs::create_dir_all(&upload_dir).ok();

    // Create a symlink
    let target_path = upload_dir.join("real_file.txt");
    std::fs::write(&target_path, b"real content").unwrap();
    let symlink_path = upload_dir.join("symlink_file.txt");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target_path, &symlink_path).unwrap();
    }

    let file_info = FileInfo {
        filename: "symlink_file.txt".to_string(),
        original_name: "Symlink.txt".to_string(),
        size: 12,
        mime_type: "text/plain".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: symlink_path.clone(),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("symlink_file.txt", file_info);

    let mut share = make_share_info("symShare1", "symlink_file.txt", "room1", "user1", 7, false);
    share.file_name = "symlink_file.txt".to_string();
    ctx.share_service.add_share("symShare1", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/symShare1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // On Unix, symlink should be rejected with FORBIDDEN
    #[cfg(unix)]
    {
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body_bytes = read_body(response.into_body()).await;
        let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
        assert!(!parsed.success);
        assert!(parsed.message.unwrap().contains("Access denied"));
    }

    // Cleanup
    std::fs::remove_file(&symlink_path).ok();
    std::fs::remove_file(&target_path).ok();
}

#[tokio::test]
async fn test_public_download_with_original_filename_metadata() {
    let ctx = DownloadTestContext::new();

    // Create a temporary file for download
    let upload_dir = std::env::temp_dir().join("cloud-clipboard-test-uploads");
    std::fs::create_dir_all(&upload_dir).ok();
    let test_file_path = upload_dir.join("storageName.pdf");
    std::fs::write(&test_file_path, b"file content").unwrap();

    let file_info = FileInfo {
        filename: "storageName.pdf".to_string(),
        original_name: "My Document.pdf".to_string(),
        size: 12,
        mime_type: "application/pdf".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: test_file_path.clone(),
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("storageName.pdf", file_info);

    // Add share with metadata containing originalFilename
    let mut share = make_share_info("metaShare1", "storageName.pdf", "room1", "user1", 7, false);
    share.file_name = "storageName.pdf".to_string();
    share.metadata = Some(std::collections::HashMap::from([
        ("originalFilename".to_string(), serde_json::Value::String("My Document.pdf".to_string())),
    ]));
    ctx.share_service.add_share("metaShare1", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/metaShare1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify content disposition uses originalFilename from metadata
    let content_disp = response
        .headers()
        .get("content-disposition")
        .expect("Should have content-disposition header");
    let disp_str = content_disp.to_str().unwrap();
    assert!(disp_str.contains("My Document.pdf"));
    assert!(!disp_str.contains("storageName.pdf"));

    // Cleanup
    std::fs::remove_file(&test_file_path).ok();
}

#[tokio::test]
async fn test_public_download_nonexistent_file_on_disk() {
    let ctx = DownloadTestContext::new();

    // Add file info to file_manager but with a path that doesn't exist on disk
    let nonexistent_path = PathBuf::from("/uploads/ghost_file.pdf");
    let file_info = FileInfo {
        filename: "ghostFile.pdf".to_string(),
        original_name: "Ghost.pdf".to_string(),
        size: 100,
        mime_type: "application/pdf".to_string(),
        room_key: "room1".to_string(),
        uploaded_at: Utc::now(),
        path: nonexistent_path,
        hash: None,
        is_duplicate: None,
        original_file_id: None,
    };
    ctx.file_manager.add_file("ghostFile.pdf", file_info);

    let mut share = make_share_info("ghostSh01", "ghostFile.pdf", "room1", "user1", 7, false);
    share.file_name = "ghostFile.pdf".to_string();
    ctx.share_service.add_share("ghostSh01", share);

    let app = ctx.download_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/ghostSh01")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // File doesn't exist on disk, should return NOT_FOUND or INTERNAL_ERROR
    assert!(
        response.status() == StatusCode::NOT_FOUND
            || response.status() == StatusCode::INTERNAL_SERVER_ERROR
    );
}
