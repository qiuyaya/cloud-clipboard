use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::routes::ApiResponse;

/// Unified application error type that implements IntoResponse.
///
/// Use this in route handlers as `Result<T, AppError>` instead of
/// manually constructing `(StatusCode, Json<ApiResponse<()>>)` tuples.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Too many requests")]
    TooManyRequests,

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Lock error")]
    LockError,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "Too many requests".to_string(),
            ),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::LockError => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
            AppError::Io(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };

        (status, Json(ApiResponse::<()> {
            success: false,
            message: Some(message),
            data: None,
        }))
            .into_response()
    }
}

/// Convert anyhow errors to AppError
impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

/// Convert String errors (from services) to AppError
impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError::Internal(err)
    }
}
