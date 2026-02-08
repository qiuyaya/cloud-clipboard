use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderName, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

// Download timeout configuration (matching Node.js DOWNLOAD_TIMEOUT env var, default 30s)
fn get_download_timeout() -> std::time::Duration {
    let timeout_ms: u64 = std::env::var("DOWNLOAD_TIMEOUT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30_000);
    std::time::Duration::from_millis(timeout_ms)
}

use crate::AppState;
use crate::middleware::rate_limit::extract_client_ip;
use super::ApiResponse;

// ============= Stream & Bandwidth Tracking =============

/// Global concurrent stream counter
static ACTIVE_STREAMS: AtomicUsize = AtomicUsize::new(0);

/// Per-IP concurrent stream tracker
static PER_IP_STREAMS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, usize>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

const MAX_CONCURRENT_GLOBAL: usize = 100;
const MAX_CONCURRENT_PER_IP: usize = 5;

/// RAII guard for stream tracking - decrements counter on drop
struct StreamGuard {
    ip: String,
}

impl StreamGuard {
    fn acquire(ip: String) -> Result<Self, ()> {
        let global = ACTIVE_STREAMS.load(Ordering::Relaxed);
        if global >= MAX_CONCURRENT_GLOBAL {
            return Err(());
        }

        let mut map = PER_IP_STREAMS.lock().map_err(|_| ())?;
        let count = map.entry(ip.clone()).or_insert(0);
        if *count >= MAX_CONCURRENT_PER_IP {
            return Err(());
        }
        *count += 1;
        ACTIVE_STREAMS.fetch_add(1, Ordering::AcqRel);
        Ok(StreamGuard { ip })
    }
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        ACTIVE_STREAMS.fetch_sub(1, Ordering::AcqRel);
        if let Ok(mut map) = PER_IP_STREAMS.lock() {
            if let Some(count) = map.get_mut(&self.ip) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(&self.ip);
                }
            }
        }
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
        // Default: MAX_FILE_SIZE * 10 per minute (matching Node.js behavior)
        // Node.js uses MAX_FILE_SIZE (default 100MB) * 10 = 1000MB/min
        let max_file_size: u64 = std::env::var("MAX_FILE_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(100 * 1024 * 1024); // 100MB default

        let max_bytes = std::env::var("MAX_DOWNLOAD_BYTES_PER_MINUTE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(max_file_size * 10); // MAX_FILE_SIZE * 10 default

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
    pub enable_password: Option<bool>,
    pub original_filename: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShareResponse {
    pub share_id: String,
    pub file_id: String,
    pub created_by: String,
    pub share_url: String,
    pub password: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub has_password: bool,
    pub access_count: u64,
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
    pub url: String,
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

/// Build a standard error response for public_download (3-tuple with empty headers)
fn download_error(status: StatusCode, message: &str) -> (StatusCode, HeaderMap, Json<ApiResponse<()>>) {
    (status, HeaderMap::new(), Json(ApiResponse {
        success: false,
        message: Some(message.to_string()),
        data: None,
    }))
}

/// Extract password from Authorization: Basic <base64> header
/// Basic Auth format: base64("username:password"), username can be empty
fn extract_basic_auth_password(headers: &HeaderMap) -> Option<String> {
    let auth_header = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    if !auth_header.starts_with("Basic ") {
        return None;
    }
    let decoded = general_purpose::STANDARD
        .decode(auth_header.trim_start_matches("Basic ").trim())
        .ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    let password = decoded_str.splitn(2, ':').nth(1)?;
    if password.is_empty() {
        None
    } else {
        Some(password.to_string())
    }
}

// ============= Router =============

pub fn router() -> Router<AppState> {
    use crate::middleware::rate_limit::{RateLimitMiddleware, RateLimitConfig, create_rate_limiter};

    let config = RateLimitConfig::from_env();

    // Create per-operation rate limiters (matching Node.js rateLimiter.ts)
    let create_limiter = RateLimitMiddleware::new(create_rate_limiter(&config, 10));   // 10/min
    let list_limiter = RateLimitMiddleware::new(create_rate_limiter(&config, 30));     // 30/min
    let revoke_limiter = RateLimitMiddleware::new(create_rate_limiter(&config, 20));   // 20/min
    let access_limiter = RateLimitMiddleware::new(create_rate_limiter(&config, 50));   // 50/min

    // Create route: POST /
    let create_routes = Router::new()
        .route("/", post(create_share))
        .layer(create_limiter);

    // List route: GET /
    let list_routes = Router::new()
        .route("/", get(list_shares))
        .layer(list_limiter.clone());

    // Detail/delete routes
    let detail_routes = Router::new()
        .route("/{share_id}", get(get_share))
        .layer(list_limiter);

    let delete_routes = Router::new()
        .route("/{share_id}", delete(delete_share))
        .route("/{share_id}/permanent-delete", post(permanent_delete))
        .layer(revoke_limiter);

    // Access log routes
    let access_routes = Router::new()
        .route("/{share_id}/access", get(get_access_logs))
        .route("/user/{user_id}", get(get_user_shares))
        .layer(access_limiter);

    Router::new()
        .merge(create_routes)
        .merge(list_routes)
        .merge(detail_routes)
        .merge(delete_routes)
        .merge(access_routes)
}

// ============= Handlers =============

/// POST /api/share
async fn create_share(
    State(state): State<AppState>,
    headers: HeaderMap,
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

    // Build metadata from original_filename if provided
    let metadata = payload.original_filename.as_ref().map(|name| {
        let mut map = std::collections::HashMap::new();
        map.insert("originalFilename".to_string(), serde_json::Value::String(name.clone()));
        map
    });

    match state.share_service.create_share(
        payload.file_path,
        payload.file_name,
        payload.file_size,
        payload.room_key,
        payload.user_id,
        expires_in_days,
        payload.enable_password.unwrap_or(false),
        payload.password.as_deref(),
        metadata,
    ) {
        Ok((share, generated_password)) => {
            // Generate full share URL using base URL and BASE_PATH
            let base_url = super::build_base_url(&headers);
            let base_path = std::env::var("BASE_PATH")
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string();
            let share_url = format!("{}{}/public/file/{}", base_url, base_path, share.share_id);
            let has_password = share.has_password();
            Ok(Json(ApiResponse {
                success: true,
                message: Some("Share created".to_string()),
                data: Some(CreateShareResponse {
                    share_id: share.share_id,
                    file_id: share.file_name.clone(),
                    has_password,
                    created_by: share.created_by,
                    share_url,
                    password: generated_password,
                    created_at: share.created_at.to_rfc3339(),
                    expires_at: share.expires_at.to_rfc3339(),
                    access_count: 0,
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

    // Build base URL for share links
    let base_url = super::build_base_url(&headers);
    let base_path = std::env::var("BASE_PATH")
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_string();

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
            let url = format!("{}{}/public/file/{}", base_url, base_path, share.share_id);
            ShareListItem {
                share_id: share.share_id,
                original_filename: share.file_name,
                file_size: share.file_size,
                created_at: share.created_at.to_rfc3339(),
                expires_at: share.expires_at.to_rfc3339(),
                status: status.to_string(),
                access_count: share.access_count,
                has_password: share.has_password,
                url,
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
    headers: HeaderMap,
    Path(share_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, (StatusCode, Json<ApiResponse<()>>)> {
    // Require user_id for ownership verification
    let user_id = extract_user_id(&headers).ok_or_else(|| (
        StatusCode::UNAUTHORIZED,
        Json(ApiResponse {
            success: false,
            message: Some("User ID required (x-user-id header)".to_string()),
            data: None,
        }),
    ))?;

    // Check share exists and verify ownership
    let share = state.share_service.get_share(&share_id).ok_or_else(|| (
        StatusCode::NOT_FOUND,
        Json(ApiResponse {
            success: false,
            message: Some("Share not found".to_string()),
            data: None,
        }),
    ))?;

    if share.created_by != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ApiResponse {
                success: false,
                message: Some("You do not have permission to revoke this share".to_string()),
                data: None,
            }),
        ));
    }

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
    let response = state.share_service.get_user_shares_response(&user_id);

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
) -> Result<impl IntoResponse, (StatusCode, HeaderMap, Json<ApiResponse<()>>)> {
    // Validate shareId format (8-10 character base62: [a-zA-Z0-9])
    if share_id.len() < 8 || share_id.len() > 10
        || !share_id.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(download_error(StatusCode::BAD_REQUEST, "Invalid share ID format"));
    }

    // Extract client IP early for per-IP stream limiting
    let client_ip = extract_client_ip(&headers);

    // Extract User-Agent for access logging
    let user_agent = headers.get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // P2.1: Check concurrent stream limit (per-IP + global)
    let _stream_guard = StreamGuard::acquire(client_ip.clone()).map_err(|_| {
        download_error(StatusCode::SERVICE_UNAVAILABLE, "Too many concurrent downloads. Please try again later.")
    })?;

    let share = state.share_service.get_share(&share_id).ok_or_else(|| {
        download_error(StatusCode::NOT_FOUND, "Share not found")
    })?;

    // Check expiration
    if share.is_expired() {
        return Err(download_error(StatusCode::NOT_FOUND, "Share not found"));
    }

    // Check if share is active
    if !share.is_active {
        return Err(download_error(StatusCode::NOT_FOUND, "Share not found"));
    }

    // Verify password if required
    if share.has_password() {
        // Prefer Basic Auth, fallback to query parameter
        let password = extract_basic_auth_password(&headers)
            .or_else(|| query.password.clone());

        match password {
            Some(pwd) if share.verify_password(&pwd) => {}
            Some(_) => {
                let _ = state.share_service.record_access(
                    &share_id,
                    client_ip,
                    false,
                    None,
                    Some("Invalid password".to_string()),
                    user_agent,
                );
                let mut headers = HeaderMap::new();
                headers.insert(
                    "WWW-Authenticate",
                    "Basic realm=\"File Download\", charset=\"UTF-8\"".parse().unwrap(),
                );
                return Err((
                    StatusCode::UNAUTHORIZED,
                    headers,
                    Json(ApiResponse {
                        success: false,
                        message: Some("Invalid password".to_string()),
                        data: None,
                    }),
                ));
            }
            None => {
                let mut headers = HeaderMap::new();
                headers.insert(
                    "WWW-Authenticate",
                    "Basic realm=\"File Download\", charset=\"UTF-8\"".parse().unwrap(),
                );
                return Err((
                    StatusCode::UNAUTHORIZED,
                    headers,
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
        download_error(StatusCode::NOT_FOUND, "File not found")
    })?;

    // P2.1: Check per-IP bandwidth limit
    if !BANDWIDTH_TRACKER.check_and_record(&client_ip, file_info.size) {
        return Err(download_error(StatusCode::TOO_MANY_REQUESTS, "Download bandwidth limit exceeded. Please try again later."));
    }

    // P2.3: TOCTOU prevention - use symlink_metadata to detect symlinks
    let metadata = std::fs::symlink_metadata(&file_info.path).map_err(|_| {
        download_error(StatusCode::NOT_FOUND, "File not found")
    })?;

    if metadata.file_type().is_symlink() {
        tracing::warn!("Symlink detected for file: {:?}", file_info.path);
        return Err(download_error(StatusCode::FORBIDDEN, "Access denied"));
    }

    // Detect hard link attacks
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() > 1 {
            tracing::warn!("Hard link detected for file: {:?}", file_info.path);
            return Err(download_error(StatusCode::FORBIDDEN, "Access denied"));
        }
    }

    // P2.3: Open file by path and verify it's within upload directory
    let upload_dir = state.file_manager.upload_dir().canonicalize().map_err(|_| {
        download_error(StatusCode::INTERNAL_SERVER_ERROR, "Server error")
    })?;

    let canonical_path = file_info.path.canonicalize().map_err(|_| {
        download_error(StatusCode::NOT_FOUND, "File not found")
    })?;

    if !canonical_path.starts_with(&upload_dir) {
        tracing::warn!("Path traversal attempt: {:?}", file_info.path);
        return Err(download_error(StatusCode::FORBIDDEN, "Access denied"));
    }

    // Open file with timeout protection (matching Node.js DOWNLOAD_TIMEOUT)
    let download_timeout = get_download_timeout();
    let file = match tokio::time::timeout(download_timeout, tokio::fs::File::open(&canonical_path)).await {
        Ok(Ok(f)) => f,
        Ok(Err(_)) => {
            return Err(download_error(StatusCode::INTERNAL_SERVER_ERROR, "Failed to open file"));
        }
        Err(_) => {
            tracing::warn!("Download timeout for shareId: {} from IP: {}", share_id, client_ip);
            return Err(download_error(StatusCode::REQUEST_TIMEOUT, "Download timeout"));
        }
    };

    // Record successful access
    let _ = state.share_service.record_access(
        &share_id,
        client_ip,
        true,
        Some(file_info.size),
        None,
        user_agent,
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
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate".to_string()),
            (HeaderName::from_static("x-content-type-options"), "nosniff".to_string()),
        ],
        body,
    ))
}
