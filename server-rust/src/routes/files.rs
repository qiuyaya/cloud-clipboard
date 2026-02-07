use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Serialize;
use tokio_util::io::ReaderStream;
use std::collections::HashSet;

use crate::AppState;

// ============= Response Types =============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub file_id: String,
    pub filename: String,
    pub original_name: String,
    pub size: u64,
    pub mime_type: String,
    pub download_url: String,
}

// ============= Constants =============

fn dangerous_extensions() -> HashSet<&'static str> {
    [
        ".exe", ".bat", ".cmd", ".com", ".scr", ".pif", ".msi", ".jar",
        ".sh", ".bash", ".ps1", ".vbs", ".php", ".asp", ".aspx", ".jsp",
        ".py", ".rb", ".pl", ".c", ".cpp", ".cs", ".java", ".go", ".rs",
        ".swift", ".dll", ".so", ".dylib", ".app", ".deb", ".rpm", ".dmg",
    ].into_iter().collect()
}

fn is_valid_filename(filename: &str) -> bool {
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

fn is_dangerous_extension(filename: &str) -> bool {
    let ext = filename.rsplit('.').next().map(|e| format!(".{}", e.to_lowercase()));
    if let Some(ext) = ext {
        dangerous_extensions().contains(ext.as_str())
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
    Router::new()
        .route("/upload", post(upload_file))
        .route("/download/{file_id}", get(download_file))
        .route("/{file_id}", delete(delete_file))
}

// ============= Handlers =============

/// POST /api/files/upload
async fn upload_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<ApiResponse<UploadResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    // First try to get room_key from header
    let mut room_key = extract_room_key(&headers);
    let mut file_data: Option<(String, String, Vec<u8>)> = None;

    while let Some(field) = multipart.next_field().await.map_err(|_| {
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

            let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();
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

    let room_key = room_key.ok_or_else(|| {
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

    let download_url = format!("/api/files/download/{}", file_info.filename);

    Ok(Json(ApiResponse {
        success: true,
        message: Some("File uploaded successfully".to_string()),
        data: Some(UploadResponse {
            file_id: file_info.filename.clone(),
            filename: file_info.filename,
            original_name: file_info.original_name,
            size: file_info.size,
            mime_type: file_info.mime_type,
            download_url,
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
    let upload_dir = state.file_manager.upload_dir().canonicalize().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                message: Some("Server error".to_string()),
                data: None,
            }),
        )
    })?;

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

    let content_disposition = format!(
        "attachment; filename=\"{}\"",
        file_info.original_name.replace('"', "\\\"")
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
