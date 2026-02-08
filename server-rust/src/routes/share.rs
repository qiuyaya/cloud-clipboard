use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use crate::AppState;
use crate::middleware::rate_limit::extract_client_ip;
use super::ApiResponse;

// ============= Stream & Bandwidth Tracking =============

/// Track concurrent download streams
static MAX_CONCURRENT_STREAMS: AtomicUsize = AtomicUsize::new(100);

/// Global concurrent stream counter
static ACTIVE_STREAMS: AtomicUsize = AtomicUsize::new(0);

/// RAII guard for stream tracking - decrements counter on drop
struct StreamGuard;

impl StreamGuard {
    fn acquire() -> Result<Self, ()> {
        let max = MAX_CONCURRENT_STREAMS.load(Ordering::Relaxed);
        loop {
            let current = ACTIVE_STREAMS.load(Ordering::Relaxed);
            if current >= max {
                return Err(());
            }
            match ACTIVE_STREAMS.compare_exchange(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(StreamGuard),
                Err(_) => continue,
            }
        }
    }
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        ACTIVE_STREAMS.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Per-IP bandwidth tracker
pub struct BandwidthTracker {
    entries: std::sync::RwLock<HashMap<String, BandwidthEntry>>,
    max_bytes_per_minute: u64,
}

struct BandwidthEntry {
    bytes: u64,
    window_start: Instant,
}

impl BandwidthTracker {
    pub fn new() -> Self {
        let max_bytes = std::env::var("MAX_DOWNLOAD_BYTES_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(500 * 1024 * 1024); // 500MB/min default

        Self {
            entries: std::sync::RwLock::new(HashMap::new()),
            max_bytes_per_minute: max_bytes,
        }
    }

    pub fn check_and_record(&self, ip: &str, bytes: u64) -> bool {
        let now = Instant::now();
        let mut entries = match self.entries.write() {
            Ok(e) => e,
            Err(_) => return true, // Allow on lock error
        };

        let entry = entries.entry(ip.to_string()).or_insert(BandwidthEntry {
            bytes: 0,
            window_start: now,
        });

        // Reset window if expired (1 minute)
        if now.duration_since(entry.window_start).as_secs() >= 60 {
            entry.bytes = 0;
            entry.window_start = now;
        }

        if entry.bytes + bytes > self.max_bytes_per_minute {
            return false;
        }

        entry.bytes += bytes;
        true
    }

    pub fn cleanup(&self) {
        let now = Instant::now();
        if let Ok(mut entries) = self.entries.write() {
            entries.retain(|_, entry| {
                now.duration_since(entry.window_start).as_secs() < 120
            });
        }
    }
}

/// Lazy-initialized global bandwidth tracker
static BANDWIDTH_TRACKER: std::sync::LazyLock<BandwidthTracker> =
    std::sync::LazyLock::new(BandwidthTracker::new);

// ============= Request/Response Types =============

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareRequest {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub room_key: String,
    pub user_id: String,
    pub expires_in_days: Option<i64>,
    pub password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareResponse {
    pub share_id: String,
    pub share_url: String,
    pub expires_at: String,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSharesQuery {
    pub user_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareListItem {
    pub share_id: String,
    pub original_filename: String,
    pub file_size: u64,
    pub created_at: String,
    pub expires_at: String,
    pub status: String,
    pub access_count: u64,
    pub has_password: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareListResponse {
    pub shares: Vec<ShareListItem>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermanentDeleteRequest {
    pub user_id: Option<String>,
}

// ============= Helper Functions =============

fn extract_user_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-user-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

// ============= Router =============

pub fn router() -> Router<AppState> {
    Router::new()
        // 创建分享
        .route("/", post(create_share))
        // 获取用户分享列表 (支持 query 参数)
        .route("/", get(list_shares))
        // 获取分享详情
        .route("/{share_id}", get(get_share))
        // 删除分享 (撤销)
        .route("/{share_id}", delete(delete_share))
        // 永久删除
        .route("/{share_id}/permanent-delete", post(permanent_delete))
        // 获取访问日志
        .route("/{share_id}/access", get(get_access_logs))
        // 获取指定用户的分享列表 (兼容旧 API)
        .route("/user/{user_id}", get(get_user_shares))
}

// ============= Handlers =============

/// POST /api/share
async fn create_share(
    State(state): State<AppState>,
    Json(payload): Json<CreateShareRequest>,
) -> Result<Json<ApiResponse<CreateShareResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    let expires_in_days = payload.expires_in_days.unwrap_or(7);

    if expires_in_days < 1 || expires_in_days > 30 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ApiResponse {
                success: false,
                message: Some("Expiration must be 1-30 days".to_string()),
                data: None,
            }),
        ));
    }

    match state.share_service.create_share(
        payload.file_path,
        payload.file_name,
        payload.file_size,
        payload.room_key,
        payload.user_id,
        expires_in_days,
        payload.password.as_deref(),
    ) {
        Ok((share, generated_password)) => {
            // Generate full share URL using BASE_PATH if configured
            let base_path = std::env::var("BASE_PATH")
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string();
            let share_url = format!("{}/public/file/{}", base_path, share.share_id);
            Ok(Json(ApiResponse {
                success: true,
                message: Some("Share created".to_string()),
                data: Some(CreateShareResponse {
                    share_id: share.share_id,
                    share_url,
                    expires_at: share.expires_at.to_rfc3339(),
                    password: generated_password,
                }),
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

/// GET /api/share
async fn list_shares(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListSharesQuery>,
) -> Json<ApiResponse<ShareListResponse>> {
    // Get user_id from header or query
    let user_id = extract_user_id(&headers)
        .or(query.user_id)
        .unwrap_or_else(|| "temp-user-id".to_string());

    let status_filter = query.status.as_deref();
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);

    // Get all user's shares
    let all_shares = state.share_service.get_user_shares(&user_id);

    // Filter by status if specified
    let now = chrono::Utc::now();
    let filtered_shares: Vec<_> = all_shares
        .into_iter()
        .filter(|share| {
            match status_filter {
                Some("active") => share.is_active && share.expires_at > now,
                Some("expired") => !share.is_active || share.expires_at <= now,
                Some("all") | None => true,
                _ => true,
            }
        })
        .collect();

    let total = filtered_shares.len();

    // Apply pagination
    let paginated: Vec<ShareListItem> = filtered_shares
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|share| {
            let status = if share.is_active && share.expires_at > now {
                "active"
            } else {
                "expired"
            };
            ShareListItem {
                share_id: share.share_id,
                original_filename: share.file_name,
                file_size: share.file_size,
                created_at: share.created_at.to_rfc3339(),
                expires_at: share.expires_at.to_rfc3339(),
                status: status.to_string(),
                access_count: share.access_count,
                has_password: share.has_password,
            }
        })
        .collect();

    Json(ApiResponse {
        success: true,
        message: None,
        data: Some(ShareListResponse {
            shares: paginated,
            total,
            limit,
            offset,
        }),
    })
}

/// GET /api/share/:shareId
async fn get_share(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> Result<Json<ApiResponse<crate::models::share::ShareInfoResponse>>, (StatusCode, Json<ApiResponse<()>>)> {
    match state.share_service.get_share_info(&share_id) {
        Some(info) => Ok(Json(ApiResponse {
            success: true,
            message: None,
            data: Some(info),
        })),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        )),
    }
}

/// DELETE /api/share/:shareId
async fn delete_share(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    match state.share_service.revoke_share(&share_id) {
        Ok(true) => Ok(Json(ApiResponse {
            success: true,
            message: Some("Share revoked".to_string()),
            data: None,
        })),
        Ok(false) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        )),
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

/// POST /api/share/:shareId/permanent-delete
async fn permanent_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
    Json(payload): Json<PermanentDeleteRequest>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    // Get user_id from header or body
    let user_id = extract_user_id(&headers)
        .or(payload.user_id)
        .unwrap_or_else(|| "temp-user-id".to_string());

    // Check if share exists
    let share = state.share_service.get_share(&share_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        )
    })?;

    // Verify ownership
    if share.created_by != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("You do not have permission to delete this share".to_string()),
                data: None,
            }),
        ));
    }

    // Permanently delete
    match state.share_service.delete_share(&share_id) {
        Ok(Some(_)) => Ok(Json(ApiResponse {
            success: true,
            message: Some("Share permanently deleted".to_string()),
            data: None,
        })),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        )),
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

/// GET /api/share/:shareId/access
async fn get_access_logs(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<crate::models::ShareAccessLog>>>, (StatusCode, Json<ApiResponse<()>>)> {
    if state.share_service.get_share(&share_id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        ));
    }

    let logs = state.share_service.get_access_logs(&share_id);
    Ok(Json(ApiResponse {
        success: true,
        message: None,
        data: Some(logs),
    }))
}

/// GET /api/share/user/:userId
async fn get_user_shares(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> Json<ApiResponse<Vec<crate::models::share::ShareInfoResponse>>> {
    let shares = state.share_service.get_user_shares(&user_id);
    let now = chrono::Utc::now();

    let response: Vec<_> = shares
        .into_iter()
        .map(|share| crate::models::share::ShareInfoResponse {
            share_id: share.share_id,
            file_name: share.file_name,
            file_size: share.file_size,
            created_at: share.created_at,
            expires_at: share.expires_at,
            is_active: share.is_active && share.expires_at > now,
            access_count: share.access_count,
            has_password: share.has_password,
        })
        .collect();

    Json(ApiResponse {
        success: true,
        message: None,
        data: Some(response),
    })
}

/// GET /public/file/:shareId
pub async fn public_download(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(share_id): Path<String>,
    Query(query): Query<DownloadQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<()>>)> {
    // P2.1: Check concurrent stream limit
    let _stream_guard = StreamGuard::acquire().map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ApiResponse {
                success: false,
                message: Some("Too many concurrent downloads. Please try again later.".to_string()),
                data: None,
            }),
        )
    })?;

    let share = state.share_service.get_share(&share_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("Share not found".to_string()),
                data: None,
            }),
        )
    })?;

    // Check expiration
    if share.is_expired() {
        return Err((
            StatusCode::GONE,
            Json(ApiResponse {
                success: false,
                message: Some("Share has expired".to_string()),
                data: None,
            }),
        ));
    }

    // Check if share is active
    if !share.is_active {
        return Err((
            StatusCode::GONE,
            Json(ApiResponse {
                success: false,
                message: Some("Share has been revoked".to_string()),
                data: None,
            }),
        ));
    }

    // Verify password if required
    let client_ip = extract_client_ip(&headers);
    if share.has_password() {
        match &query.password {
            Some(pwd) if share.verify_password(pwd) => {}
            Some(_) => {
                let _ = state.share_service.record_access(
                    &share_id,
                    client_ip,
                    false,
                    None,
                    Some("Invalid password".to_string()),
                );
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Invalid password".to_string()),
                        data: None,
                    }),
                ));
            }
            None => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Password required".to_string()),
                        data: None,
                    }),
                ));
            }
        }
    }

    // Get file
    let file_info = state.file_manager.get_file(&share.file_path).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    // P2.1: Check per-IP bandwidth limit
    if !BANDWIDTH_TRACKER.check_and_record(&client_ip, file_info.size) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ApiResponse {
                success: false,
                message: Some("Download bandwidth limit exceeded. Please try again later.".to_string()),
                data: None,
            }),
        ));
    }

    // P2.3: TOCTOU prevention - use symlink_metadata to detect symlinks
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
        tracing::warn!("Symlink detected for file: {:?}", file_info.path);
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("Access denied".to_string()),
                data: None,
            }),
        ));
    }

    // P2.3: Open file by path and verify it's within upload directory
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

    let canonical_path = file_info.path.canonicalize().map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse {
                success: false,
                message: Some("File not found".to_string()),
                data: None,
            }),
        )
    })?;

    if !canonical_path.starts_with(&upload_dir) {
        tracing::warn!("Path traversal attempt: {:?}", file_info.path);
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("Access denied".to_string()),
                data: None,
            }),
        ));
    }

    let file = tokio::fs::File::open(&canonical_path).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiResponse {
                success: false,
                message: Some("Failed to open file".to_string()),
                data: None,
            }),
        )
    })?;

    // Record successful access
    let _ = state.share_service.record_access(
        &share_id,
        client_ip,
        true,
        Some(file_info.size),
        None,
    );

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let content_disposition = format!(
        "attachment; filename=\"{}\"",
        share.file_name.replace('"', "\\\"")
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
