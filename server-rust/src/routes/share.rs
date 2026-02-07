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

use crate::AppState;

// ============= Request/Response Types =============

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

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
            let share_url = format!("/public/file/{}", share.share_id);
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
    Path(share_id): Path<String>,
    Query(query): Query<DownloadQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<()>>)> {
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
    if share.has_password() {
        match &query.password {
            Some(pwd) if share.verify_password(pwd) => {}
            Some(_) => {
                let _ = state.share_service.record_access(
                    &share_id,
                    "unknown".to_string(),
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

    // Record successful access
    let _ = state.share_service.record_access(
        &share_id,
        "unknown".to_string(),
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
