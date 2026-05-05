/// Files Handler Integration Tests
///
/// Tests for file upload, download, and deletion HTTP endpoints
/// using real FileManager with tempfile for filesystem operations.
use axum::body::Body;
use axum::http::{Request, StatusCode};
use cloud_clipboard_server::routes::files::router;
use cloud_clipboard_server::services::file_manager::FileManager;
use cloud_clipboard_server::services::traits::*;
use http_body_util::BodyExt;
use serde::Deserialize;
use std::sync::Arc;
use tempfile::TempDir;
use tower::ServiceExt;

mod common;

use common::mocks::{MockRoomService, MockShareService};
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
struct UploadData {
    #[serde(default)]
    file_id: String,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    size: u64,
    #[serde(rename = "type", default)]
    file_type: String,
}

// ============= Multipart Body Construction =============

/// Build a multipart/form-data body with a roomKey field and a file field.
fn build_multipart_upload_body(
    boundary: &str,
    room_key: &str,
    filename: &str,
    content_type: &str,
    file_data: &[u8],
) -> Vec<u8> {
    let mut body = Vec::new();

    // roomKey field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice("Content-Disposition: form-data; name=\"roomKey\"\r\n\r\n".as_bytes());
    body.extend_from_slice(room_key.as_bytes());
    body.extend_from_slice(b"\r\n");

    // file field
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
    body.extend_from_slice(file_data);
    body.extend_from_slice(b"\r\n");

    // closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    body
}

/// Build a multipart body with only a file field (no roomKey).
fn build_multipart_no_room_key(
    boundary: &str,
    filename: &str,
    content_type: &str,
    file_data: &[u8],
) -> Vec<u8> {
    let mut body = Vec::new();

    // file field only
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
            filename
        )
        .as_bytes(),
    );
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
    body.extend_from_slice(file_data);
    body.extend_from_slice(b"\r\n");

    // closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    body
}

/// Build a multipart body with only a roomKey field (no file).
fn build_multipart_no_file(boundary: &str, room_key: &str) -> Vec<u8> {
    let mut body = Vec::new();

    // roomKey field only
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice("Content-Disposition: form-data; name=\"roomKey\"\r\n\r\n".as_bytes());
    body.extend_from_slice(room_key.as_bytes());
    body.extend_from_slice(b"\r\n");

    // closing boundary
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    body
}

// ============= Test Context =============

struct TestContext {
    _room_service: Arc<MockRoomService>,
    file_manager: Arc<FileManager>,
    _share_service: Arc<MockShareService>,
    _temp_dir: TempDir,
    state: cloud_clipboard_server::AppState,
}

impl TestContext {
    fn new() -> Self {
        // Ensure global config is initialized (required by build_base_url in upload handler)
        let _ = cloud_clipboard_server::config::init_config();
        Self::new_with_max_file_size(100 * 1024 * 1024)
    }

    fn new_with_max_file_size(max_file_size: u64) -> Self {
        let temp_dir = TempDir::new().unwrap();
        let room_service = Arc::new(MockRoomService::new());
        let file_manager = Arc::new(
            FileManager::new_with_config(
                temp_dir.path().to_path_buf(),
                max_file_size,
                1024 * 1024 * 1024, // 1GB total storage
                12,
            )
            .unwrap(),
        );
        let share_service = Arc::new(MockShareService::new());
        let state = create_test_app_state(
            room_service.clone() as Arc<dyn RoomServiceTrait>,
            file_manager.clone() as Arc<dyn FileManagerTrait>,
            share_service.clone() as Arc<dyn ShareServiceTrait>,
        );
        Self {
            _room_service: room_service,
            file_manager,
            _share_service: share_service,
            _temp_dir: temp_dir,
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

// ============= Upload Tests =============

#[tokio::test]
async fn test_upload_file_success() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary123";
    let body = build_multipart_upload_body(
        boundary,
        "testRoom1",
        "hello.txt",
        "text/plain",
        b"Hello, World!",
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<UploadData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(
        parsed.message.as_deref(),
        Some("File uploaded successfully")
    );

    let data = parsed.data.unwrap();
    assert!(!data.file_id.is_empty());
    assert!(data.download_url.contains("/api/files/download/"));
    assert_eq!(data.name, "hello.txt");
    assert_eq!(data.size, 13); // "Hello, World!" = 13 bytes
    assert_eq!(data.file_type, "text/plain");
}

#[tokio::test]
async fn test_upload_file_with_header_room_key() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary456";
    // Build multipart with only file field, room key in header
    let body = build_multipart_no_room_key(
        boundary,
        "photo.png",
        "image/png",
        b"\x89PNG\r\n\x1a\n", // PNG header bytes
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .header("x-room-key", "headerRoom1")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<UploadData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.data.unwrap().name, "photo.png");
}

#[tokio::test]
async fn test_upload_file_missing_room_key() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary789";
    // Multipart with file but no roomKey field and no x-room-key header
    let body = build_multipart_no_room_key(boundary, "test.txt", "text/plain", b"content");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("roomKey is required"));
}

#[tokio::test]
async fn test_upload_file_missing_file_field() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary101";
    // Multipart with roomKey but no file field
    let body = build_multipart_no_file(boundary, "testRoom1");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("file is required"));
}

#[tokio::test]
async fn test_upload_file_too_large() {
    // Create context with very small max file size (100 bytes)
    let ctx = TestContext::new_with_max_file_size(100);
    let app = ctx.app();

    let boundary = "testboundary202";
    // Create file data larger than max_file_size
    let large_data = vec![b'X'; 101];
    let body = build_multipart_upload_body(
        boundary,
        "testRoom1",
        "large.bin",
        "application/octet-stream",
        &large_data,
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("too large"));
}

#[tokio::test]
async fn test_upload_file_dangerous_extension() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary303";
    let body = build_multipart_upload_body(
        boundary,
        "testRoom1",
        "malware.exe",
        "application/octet-stream",
        b"MZ",
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("not allowed"));
}

#[tokio::test]
async fn test_upload_file_invalid_filename_path_traversal() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let boundary = "testboundary404";
    let body = build_multipart_upload_body(
        boundary,
        "testRoom1",
        "../etc/passwd",
        "text/plain",
        b"root:x:0:0",
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid filename"));
}

// ============= Download Tests =============

#[tokio::test]
async fn test_download_file_success() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // First, upload a file using FileManager directly
    let file_info = ctx
        .file_manager
        .save_file("testRoom1", "download.txt", "text/plain", b"Download me!")
        .await
        .unwrap();
    let file_id = file_info.filename.clone();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/download/{}", file_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify Content-Type header
    let content_type = response.headers().get("content-type").unwrap();
    assert_eq!(content_type, "text/plain");

    // Verify Content-Disposition header
    let content_disposition = response.headers().get("content-disposition").unwrap();
    let disposition_str = content_disposition.to_str().unwrap();
    assert!(disposition_str.contains("attachment"));
    assert!(disposition_str.contains("download.txt"));

    // Verify body content
    let body_bytes = read_body(response.into_body()).await;
    assert_eq!(body_bytes, b"Download me!");
}

#[tokio::test]
async fn test_download_file_invalid_id_path_traversal() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/download/..%2F..%2Fetc%2Fpasswd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // The path traversal should be rejected by validate_file_id
    // Note: Axum URL-decodes the path parameter, so ".." will be in the file_id
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Invalid file ID"));
}

#[tokio::test]
async fn test_download_file_invalid_id_empty() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/download/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Empty file_id should be rejected - this will likely 404 from router
    // since {file_id} requires a non-empty segment
    assert!(
        response.status() == StatusCode::NOT_FOUND || response.status() == StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn test_download_file_not_found() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/download/nonexistent-file-id.txt")
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
async fn test_download_file_invalid_id_too_long() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let long_id = format!("{}.txt", "a".repeat(256));
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/download/{}", long_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
}

#[tokio::test]
async fn test_download_file_slash_in_id() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // Slash in file_id should be rejected (path traversal prevention)
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                // Use a path that won't be interpreted as a route segment
                .uri("/download/foo%5Cbar") // foo\bar (backslash)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
}

// ============= Delete Tests =============

#[tokio::test]
async fn test_delete_file_success() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // First, upload a file using FileManager directly
    let file_info = ctx
        .file_manager
        .save_file("testRoom1", "delete-me.txt", "text/plain", b"Delete me!")
        .await
        .unwrap();
    let file_id = file_info.filename.clone();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/{}", file_id))
                .header("x-room-key", "testRoom1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    assert_eq!(parsed.message.as_deref(), Some("File deleted successfully"));

    // Verify file is actually deleted
    assert!(ctx.file_manager.get_file(&file_id).is_none());
}

#[tokio::test]
async fn test_delete_file_missing_room_key() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // Upload a file first
    let file_info = ctx
        .file_manager
        .save_file("testRoom1", "protected.txt", "text/plain", b"Protected")
        .await
        .unwrap();
    let file_id = file_info.filename.clone();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/{}", file_id))
                // No x-room-key header
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(
        parsed
            .message
            .unwrap()
            .contains("Missing x-room-key header")
    );
}

#[tokio::test]
async fn test_delete_file_wrong_room_key() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // Upload a file in testRoom1
    let file_info = ctx
        .file_manager
        .save_file("testRoom1", "owned.txt", "text/plain", b"Owned by room1")
        .await
        .unwrap();
    let file_id = file_info.filename.clone();

    // Try to delete from a different room
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/{}", file_id))
                .header("x-room-key", "differentRoom")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
    assert!(parsed.message.unwrap().contains("Access denied"));
}

#[tokio::test]
async fn test_delete_file_not_found() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/nonexistent-file-id.txt")
                .header("x-room-key", "testRoom1")
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
async fn test_delete_file_invalid_id() {
    let ctx = TestContext::new();
    let app = ctx.app();

    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/..%2F..%2Fetc%2Fpasswd")
                .header("x-room-key", "testRoom1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(!parsed.success);
}

// ============= End-to-End: Upload then Download then Delete =============

#[tokio::test]
async fn test_upload_download_delete_flow() {
    let ctx = TestContext::new();
    let app = ctx.app();

    // 1. Upload via HTTP
    let boundary = "flowboundary";
    let upload_body = build_multipart_upload_body(
        boundary,
        "flowRoom1",
        "flow-test.txt",
        "text/plain",
        b"Flow test content",
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header(
                    "content-type",
                    format!("multipart/form-data; boundary={}", boundary),
                )
                .body(Body::from(upload_body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<UploadData> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);
    let file_id = parsed.data.unwrap().file_id;

    // 2. Download via HTTP - need a fresh app since oneshot consumes
    let app2 = ctx.app();
    let response = app2
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/download/{}", file_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let download_bytes = read_body(response.into_body()).await;
    assert_eq!(download_bytes, b"Flow test content");

    // 3. Delete via HTTP
    let app3 = ctx.app();
    let response = app3
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/{}", file_id))
                .header("x-room-key", "flowRoom1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = read_body(response.into_body()).await;
    let parsed: ApiResponse<()> = serde_json::from_slice(&body_bytes).unwrap();
    assert!(parsed.success);

    // 4. Verify file no longer downloadable
    let app4 = ctx.app();
    let response = app4
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/download/{}", file_id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
