use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{delete, get, post},
};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;
use std::collections::HashSet;
use tokio_util::io::ReaderStream;

use super::ApiResponse;
use crate::AppState;

// ============= Response Types =============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub file_id: String,
    pub download_url: String,
    #[serde(rename = "name")]
    pub name: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub file_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<u64>,
    pub is_duplicate: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_file_id: Option<String>,
}

// ============= Constants =============

static DANGEROUS_EXTENSIONS: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| {
        [
            ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".msi", ".jar", ".sh", ".bash", ".ps1",
            ".vbs", ".php", ".asp", ".aspx", ".jsp", ".py", ".rb", ".pl", ".c", ".cpp", ".cs",
            ".java", ".go", ".rs", ".swift", ".dll", ".so", ".dylib", ".app", ".deb", ".rpm",
            ".dmg",
        ]
        .into_iter()
        .collect()
    });

pub fn is_valid_filename(filename: &str) -> bool {
    !filename.contains("..")
        && !filename.contains('/')
        && !filename.contains('\\')
        && !filename.contains(':')
        && !filename.contains('*')
        && !filename.contains('?')
        && !filename.contains('"')
        && !filename.contains('<')
        && !filename.contains('>')
        && !filename.contains('|')
}

pub fn is_dangerous_extension(filename: &str) -> bool {
    let ext = filename
        .rsplit('.')
        .next()
        .map(|e| format!(".{}", e.to_lowercase()));
    if let Some(ext) = ext {
        DANGEROUS_EXTENSIONS.contains(ext.as_str())
    } else {
        false
    }
}

// ============= Helper Functions =============

fn extract_room_key(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-room-key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn require_room_key(headers: &HeaderMap) -> Result<String, (StatusCode, Json<ApiResponse<()>>)> {
    extract_room_key(headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse {
                success: false,
                message: Some("Missing x-room-key header".to_string()),
                data: None,
            }),
        )
    })
}

fn validate_file_id(file_id: &str) -> Result<(), (StatusCode, Json<ApiResponse<()>>)> {
    // Check for path traversal attempts
    if file_id.contains("..") || file_id.contains('/') || file_id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("Invalid file ID".to_string()),
                data: None,
            }),
        ));
    }

    // Check file ID format (should match UUID_timestamp.ext pattern)
    if file_id.len() > 255 || file_id.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("Invalid file ID format".to_string()),
                data: None,
            }),
        ));
    }

    Ok(())
}

// ============= Router =============

pub fn router() -> Router<AppState> {
    use crate::middleware::rate_limit::{
        RateLimitConfig, RateLimitMiddleware, create_rate_limiter,
    };

    let config = RateLimitConfig::from_env();

    // Upload rate limit: 5/min (matching Node.js uploadRateLimit)
    let upload_limiter = RateLimitMiddleware::new(create_rate_limiter(&config, 5));

    let upload_routes = Router::new()
        .route("/upload", post(upload_file))
        .layer(upload_limiter);

    let other_routes = Router::new()
        .route("/download/{file_id}", get(download_file))
        .route("/{file_id}", delete(delete_file));

    Router::new().merge(upload_routes).merge(other_routes)
}

// ============= Handlers =============

/// POST /api/files/upload
async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<UploadResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    // First try to get room_key from header
    let room_key_header = extract_room_key(&headers);
    let mut room_key = room_key_header;
    let mut file_data: Option<(String, String, Vec<u8>)> = None;

    // Debug: Log room key from header
    tracing::debug!(?room_key, "Room key from header");

    let mut field_count = 0;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(?e, "Multipart parse error");
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("Failed to parse multipart".to_string()),
                data: None,
            }),
        )
    })? {
        let name = field.name().unwrap_or("").to_string();
        field_count += 1;
        tracing::debug!(field_name = %name, field_count, "Processing multipart field");

        if name == "roomKey" && room_key.is_none() {
            room_key = Some(field.text().await.map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Failed to read roomKey".to_string()),
                        data: None,
                    }),
                )
            })?);
        } else if name == "file" {
            let filename = field.file_name().unwrap_or("unknown").to_string();

            // Validate filename
            if !is_valid_filename(&filename) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Invalid filename".to_string()),
                        data: None,
                    }),
                ));
            }

            // Check for dangerous extensions
            if is_dangerous_extension(&filename) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse {
                        success: false,
                        message: Some("File type not allowed".to_string()),
                        data: None,
                    }),
                ));
            }

            let content_type = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_string();
            let data = field.bytes().await.map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Failed to read file".to_string()),
                        data: None,
                    }),
                )
            })?;
            file_data = Some((filename, content_type, data.to_vec()));
        }
    }

    tracing::debug!(?room_key, field_count, "Processing complete");

    let room_key = room_key.ok_or_else(|| {
        tracing::warn!("Room key missing from both header and multipart");
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("roomKey is required".to_string()),
                data: None,
            }),
        )
    })?;

    let (filename, content_type, data) = file_data.ok_or_else(|| {
        tracing::warn!("File data missing from multipart");
        (
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("file is required".to_string()),
                data: None,
            }),
        )
    })?;

    // Check file size
    if data.len() as u64 > state.file_manager.max_file_size() {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(ApiResponse {
                success: false,
                message: Some("File too large".to_string()),
                data: None,
            }),
        ));
    }

    // P2.2: Validate file type via magic bytes
    if let Some(inferred) = infer::get(&data) {
        let inferred_mime = inferred.mime_type();
        // Block executable types detected by magic bytes
        let blocked_mimes = [
            "application/x-executable",
            "application/x-mach-binary",
            "application/x-elf",
            "application/x-dosexec",
            "application/vnd.microsoft.portable-executable",
        ];
        if blocked_mimes.contains(&inferred_mime) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ApiResponse {
                    success: false,
                    message: Some("File type not allowed (executable detected)".to_string()),
                    data: None,
                }),
            ));
        }
    }

    let file_info = state
        .file_manager
        .save_file(&room_key, &filename, &content_type, &data)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    message: Some(e.to_string()),
                    data: None,
                }),
            )
        })?;

    let base_url = super::build_base_url(&headers);
    let download_url = format!("{}/api/files/download/{}", base_url, file_info.filename);
    let last_modified = file_info.uploaded_at.timestamp_millis() as u64;

    Ok(Json(ApiResponse {
        success: true,
        message: Some("File uploaded successfully".to_string()),
        data: Some(UploadResponse {
            file_id: file_info.filename,
            download_url,
            name: file_info.original_name,
            size: file_info.size,
            file_type: file_info.mime_type,
            last_modified: Some(last_modified),
            is_duplicate: file_info.is_duplicate.unwrap_or(false),
            original_file_id: file_info.original_file_id,
        }),
    }))
}

/// GET /api/files/download/:fileId
async fn download_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<()>>)> {
    // Validate file ID
    validate_file_id(&file_id)?;

    let file_info = state.file_manager.get_file(&file_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    // Ensure file path is within upload directory (prevent path traversal)
    let upload_dir = state
        .file_manager
        .upload_dir()
        .canonicalize()
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    message: Some("Server error".to_string()),
                    data: None,
                }),
            )
        })?;

    // P2.3: Check for symlinks before canonicalizing
    let metadata = std::fs::symlink_metadata(&file_info.path).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    if metadata.file_type().is_symlink() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("Access denied".to_string()),
                data: None,
            }),
        ));
    }

    let file_path = file_info.path.canonicalize().map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    if !file_path.starts_with(&upload_dir) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("Access denied".to_string()),
                data: None,
            }),
        ));
    }

    let file = tokio::fs::File::open(&file_info.path).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                message: Some("Failed to open file".to_string()),
                data: None,
            }),
        )
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    // RFC 5987 encoding for non-ASCII filenames
    let filename_encoded =
        utf8_percent_encode(&file_info.original_name, NON_ALPHANUMERIC).to_string();
    let content_disposition = format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        file_info.original_name.replace('"', "\\\""),
        filename_encoded
    );

    Ok((
        [
            (header::CONTENT_TYPE, file_info.mime_type),
            (header::CONTENT_DISPOSITION, content_disposition),
            (header::CONTENT_LENGTH, file_info.size.to_string()),
        ],
        body,
    ))
}

/// DELETE /api/files/:fileId
async fn delete_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    // Require authentication
    let room_key = require_room_key(&headers)?;

    // Validate file ID
    validate_file_id(&file_id)?;

    // Get file info
    let file_info = state.file_manager.get_file(&file_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    // Verify user has access to this file's room
    if file_info.room_key != room_key {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("Access denied".to_string()),
                data: None,
            }),
        ));
    }

    // Delete the file
    state
        .file_manager
        .delete_file(&file_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ApiResponse {
                    success: false,
                    message: Some(e.to_string()),
                    data: None,
                }),
            )
        })?;

    Ok(Json(ApiResponse {
        success: true,
        message: Some("File deleted successfully".to_string()),
        data: None,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::HeaderValue;

    // ============= is_valid_filename tests =============

    #[test]
    fn valid_filename_normal() {
        assert!(is_valid_filename("photo.jpg"));
        assert!(is_valid_filename("document.pdf"));
        assert!(is_valid_filename("my file.txt"));
    }

    #[test]
    fn valid_filename_rejects_path_traversal() {
        assert!(!is_valid_filename("../etc/passwd"));
        assert!(!is_valid_filename("foo/../../bar"));
        assert!(!is_valid_filename(".."));
    }

    #[test]
    fn valid_filename_rejects_slashes() {
        assert!(!is_valid_filename("foo/bar.txt"));
        assert!(!is_valid_filename("foo\\bar.txt"));
    }

    #[test]
    fn valid_filename_rejects_special_chars() {
        assert!(!is_valid_filename("file:name"));
        assert!(!is_valid_filename("file*name"));
        assert!(!is_valid_filename("file?name"));
        assert!(!is_valid_filename("file\"name"));
        assert!(!is_valid_filename("file<name"));
        assert!(!is_valid_filename("file>name"));
        assert!(!is_valid_filename("file|name"));
    }

    // ============= is_dangerous_extension tests =============

    #[test]
    fn dangerous_extension_exe() {
        assert!(is_dangerous_extension("program.exe"));
        assert!(is_dangerous_extension("script.bat"));
        assert!(is_dangerous_extension("command.cmd"));
        assert!(is_dangerous_extension("shell.sh"));
        assert!(is_dangerous_extension("app.dll"));
        assert!(is_dangerous_extension("lib.so"));
        assert!(is_dangerous_extension("app.dmg"));
    }

    #[test]
    fn safe_extension_txt() {
        assert!(!is_dangerous_extension("document.txt"));
        assert!(!is_dangerous_extension("photo.jpg"));
        assert!(!is_dangerous_extension("archive.zip"));
        assert!(!is_dangerous_extension("data.json"));
    }

    #[test]
    fn no_extension_is_safe() {
        assert!(!is_dangerous_extension("README"));
        assert!(!is_dangerous_extension("Makefile"));
    }

    #[test]
    fn dangerous_extension_case_insensitive() {
        assert!(is_dangerous_extension("program.EXE"));
        assert!(is_dangerous_extension("script.Bat"));
        assert!(is_dangerous_extension("app.DLL"));
    }

    // ============= validate_file_id tests =============

    #[test]
    fn validate_file_id_normal() {
        assert!(validate_file_id("abc123.jpg").is_ok());
        assert!(validate_file_id("uuid_timestamp.png").is_ok());
    }

    #[test]
    fn validate_file_id_rejects_path_traversal() {
        assert!(validate_file_id("../etc/passwd").is_err());
        assert!(validate_file_id("foo/../../bar").is_err());
        assert!(validate_file_id("foo\\bar").is_err());
    }

    #[test]
    fn validate_file_id_rejects_empty() {
        assert!(validate_file_id("").is_err());
    }

    #[test]
    fn validate_file_id_rejects_too_long() {
        let long_id = "a".repeat(256);
        assert!(validate_file_id(&long_id).is_err());
    }

    #[test]
    fn validate_file_id_accepts_max_length() {
        let max_id = "a".repeat(255);
        assert!(validate_file_id(&max_id).is_ok());
    }

    // ============= extract_room_key tests =============

    #[test]
    fn extract_room_key_from_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-room-key", HeaderValue::from_static("my-room"));
        assert_eq!(extract_room_key(&headers), Some("my-room".to_string()));
    }

    #[test]
    fn extract_room_key_missing_header() {
        let headers = HeaderMap::new();
        assert_eq!(extract_room_key(&headers), None);
    }

    // ============= require_room_key tests =============

    #[test]
    fn require_room_key_returns_key_when_present() {
        let mut headers = HeaderMap::new();
        headers.insert("x-room-key", HeaderValue::from_static("room1"));
        let result = require_room_key(&headers);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "room1");
    }

    #[test]
    fn require_room_key_returns_error_when_missing() {
        let headers = HeaderMap::new();
        let result = require_room_key(&headers);
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    // ============= UploadResponse serialization =============

    #[test]
    fn upload_response_serialization() {
        let resp = UploadResponse {
            file_id: "f1".to_string(),
            download_url: "http://example.com/f1".to_string(),
            name: "photo.jpg".to_string(),
            size: 1024,
            file_type: "image/jpeg".to_string(),
            last_modified: Some(1700000000000),
            is_duplicate: false,
            original_file_id: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"fileId\":\"f1\""));
        assert!(json.contains("\"name\":\"photo.jpg\""));
        assert!(json.contains("\"type\":\"image/jpeg\""));
        assert!(json.contains("\"isDuplicate\":false"));
        assert!(!json.contains("originalFileId"));
    }

    #[test]
    fn upload_response_with_original_file_id() {
        let resp = UploadResponse {
            file_id: "f2".to_string(),
            download_url: "http://example.com/f2".to_string(),
            name: "doc.pdf".to_string(),
            size: 2048,
            file_type: "application/pdf".to_string(),
            last_modified: None,
            is_duplicate: true,
            original_file_id: Some("f1".to_string()),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"originalFileId\":\"f1\""));
        assert!(json.contains("\"isDuplicate\":true"));
        assert!(!json.contains("lastModified"));
    }

    // ============= Additional tests =============

    #[test]
    fn valid_filename_empty() {
        assert!(is_valid_filename(""));
    }

    #[test]
    fn valid_filename_with_spaces() {
        assert!(is_valid_filename("my document file.pdf"));
    }

    #[test]
    fn valid_filename_unicode() {
        assert!(is_valid_filename("文档.pdf"));
        assert!(is_valid_filename("写真.jpg"));
    }

    #[test]
    fn dangerous_extension_all_types() {
        assert!(is_dangerous_extension("app.msi"));
        assert!(is_dangerous_extension("app.jar"));
        assert!(is_dangerous_extension("script.bash"));
        assert!(is_dangerous_extension("script.ps1"));
        assert!(is_dangerous_extension("script.vbs"));
        assert!(is_dangerous_extension("page.php"));
        assert!(is_dangerous_extension("page.asp"));
        assert!(is_dangerous_extension("page.aspx"));
        assert!(is_dangerous_extension("page.jsp"));
        assert!(is_dangerous_extension("script.py"));
        assert!(is_dangerous_extension("script.rb"));
        assert!(is_dangerous_extension("script.pl"));
        assert!(is_dangerous_extension("app.com"));
        assert!(is_dangerous_extension("app.scr"));
        assert!(is_dangerous_extension("app.pif"));
    }

    #[test]
    fn dangerous_extension_source_code() {
        assert!(is_dangerous_extension("main.c"));
        assert!(is_dangerous_extension("main.cpp"));
        assert!(is_dangerous_extension("main.cs"));
        assert!(is_dangerous_extension("Main.java"));
        assert!(is_dangerous_extension("main.go"));
        assert!(is_dangerous_extension("main.rs"));
        assert!(is_dangerous_extension("main.swift"));
    }

    #[test]
    fn dangerous_extension_package_formats() {
        assert!(is_dangerous_extension("app.app"));
        assert!(is_dangerous_extension("app.deb"));
        assert!(is_dangerous_extension("app.rpm"));
    }

    #[test]
    fn safe_extension_common_files() {
        assert!(!is_dangerous_extension("data.csv"));
        assert!(!is_dangerous_extension("style.css"));
        assert!(!is_dangerous_extension("script.js"));
        assert!(!is_dangerous_extension("page.html"));
        assert!(!is_dangerous_extension("doc.md"));
        assert!(!is_dangerous_extension("image.png"));
        assert!(!is_dangerous_extension("image.gif"));
        assert!(!is_dangerous_extension("image.webp"));
        assert!(!is_dangerous_extension("audio.mp3"));
        assert!(!is_dangerous_extension("video.mp4"));
    }

    #[test]
    fn validate_file_id_with_dots() {
        assert!(validate_file_id("abc.def.jpg").is_ok());
    }

    #[test]
    fn validate_file_id_error_status() {
        let result = validate_file_id("../etc/passwd");
        assert!(result.is_err());
        let (status, json) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json.success);
    }

    #[test]
    fn validate_file_id_empty_error_status() {
        let result = validate_file_id("");
        assert!(result.is_err());
        let (status, json) = result.unwrap_err();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(!json.success);
    }

    #[test]
    fn require_room_key_error_message() {
        let headers = HeaderMap::new();
        let result = require_room_key(&headers);
        assert!(result.is_err());
        let (_, json) = result.unwrap_err();
        assert_eq!(json.message.as_deref(), Some("Missing x-room-key header"));
    }

    #[test]
    fn extract_room_key_invalid_utf8() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-room-key",
            HeaderValue::from_bytes(&[0xFF, 0xFE]).unwrap(),
        );
        // Invalid UTF-8 should return None
        assert_eq!(extract_room_key(&headers), None);
    }

    #[test]
    fn upload_response_size_zero() {
        let resp = UploadResponse {
            file_id: "f1".to_string(),
            download_url: "http://example.com/f1".to_string(),
            name: "empty.txt".to_string(),
            size: 0,
            file_type: "text/plain".to_string(),
            last_modified: None,
            is_duplicate: false,
            original_file_id: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"size\":0"));
    }
}
