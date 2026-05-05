use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

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

        (
            status,
            Json(ApiResponse::<()> {
                success: false,
                message: Some(message),
                data: None,
            }),
        )
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    fn into_status(error: AppError) -> StatusCode {
        let response = error.into_response();
        response.status()
    }

    #[test]
    fn not_found_returns_404() {
        assert_eq!(
            into_status(AppError::NotFound("item".into())),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn bad_request_returns_400() {
        assert_eq!(
            into_status(AppError::BadRequest("invalid".into())),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn unauthorized_returns_401() {
        assert_eq!(
            into_status(AppError::Unauthorized("token".into())),
            StatusCode::UNAUTHORIZED
        );
    }

    #[test]
    fn forbidden_returns_403() {
        assert_eq!(
            into_status(AppError::Forbidden("denied".into())),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn too_many_requests_returns_429() {
        assert_eq!(
            into_status(AppError::TooManyRequests),
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[test]
    fn internal_returns_500() {
        assert_eq!(
            into_status(AppError::Internal("oops".into())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn lock_error_returns_500() {
        assert_eq!(
            into_status(AppError::LockError),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn io_error_returns_500() {
        let io_err = std::io::Error::other("disk failure");
        assert_eq!(
            into_status(AppError::Io(io_err)),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn display_format() {
        assert_eq!(AppError::NotFound("x".into()).to_string(), "Not found: x");
        assert_eq!(
            AppError::BadRequest("y".into()).to_string(),
            "Bad request: y"
        );
        assert_eq!(AppError::TooManyRequests.to_string(), "Too many requests");
        assert_eq!(AppError::LockError.to_string(), "Lock error");
    }

    #[test]
    fn from_anyhow_error() {
        let err = anyhow::anyhow!("something failed");
        let app_err: AppError = err.into();
        match app_err {
            AppError::Internal(msg) => assert!(msg.contains("something failed")),
            other => panic!("Expected Internal, got {:?}", other),
        }
    }

    #[test]
    fn from_string() {
        let app_err: AppError = "service error".to_string().into();
        match app_err {
            AppError::Internal(msg) => assert_eq!(msg, "service error"),
            other => panic!("Expected Internal, got {:?}", other),
        }
    }

    // --- JSON body verification tests ---

    async fn assert_json_body(
        error: AppError,
        expected_status: StatusCode,
        expected_message: &str,
    ) {
        let response = error.into_response();
        let (parts, body) = response.into_parts();
        assert_eq!(parts.status, expected_status);
        let body_bytes = axum::body::to_bytes(body, 1024).await.unwrap();
        let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(body_json["success"], false);
        assert_eq!(body_json["message"], expected_message);
        // data field is skipped when None (skip_serializing_if), so it should not be present
        assert!(body_json.get("data").is_none());
    }

    #[tokio::test]
    async fn into_response_json_body_not_found() {
        assert_json_body(
            AppError::NotFound("Resource not found".to_string()),
            StatusCode::NOT_FOUND,
            "Resource not found",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_bad_request() {
        assert_json_body(
            AppError::BadRequest("Invalid input".to_string()),
            StatusCode::BAD_REQUEST,
            "Invalid input",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_unauthorized() {
        assert_json_body(
            AppError::Unauthorized("Token expired".to_string()),
            StatusCode::UNAUTHORIZED,
            "Token expired",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_forbidden() {
        assert_json_body(
            AppError::Forbidden("Access denied".to_string()),
            StatusCode::FORBIDDEN,
            "Access denied",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_too_many_requests() {
        assert_json_body(
            AppError::TooManyRequests,
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_internal() {
        assert_json_body(
            AppError::Internal("Something went wrong".to_string()),
            StatusCode::INTERNAL_SERVER_ERROR,
            "Something went wrong",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_lock_error() {
        assert_json_body(
            AppError::LockError,
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal server error",
        )
        .await;
    }

    #[tokio::test]
    async fn into_response_json_body_io_error() {
        let io_err = std::io::Error::other("disk failure");
        assert_json_body(
            AppError::Io(io_err),
            StatusCode::INTERNAL_SERVER_ERROR,
            "disk failure",
        )
        .await;
    }

    #[test]
    fn from_anyhow_into_internal() {
        let err = anyhow::anyhow!("db connection lost");
        let app_err: AppError = err.into();
        assert!(
            matches!(app_err, AppError::Internal(ref msg) if msg.contains("db connection lost"))
        );
    }

    #[test]
    fn from_string_into_internal() {
        let app_err: AppError = "room not found".to_string().into();
        assert!(matches!(app_err, AppError::Internal(ref msg) if msg == "room not found"));
    }

    #[tokio::test]
    async fn into_response_full_body_structure() {
        let response = AppError::NotFound("test item".to_string()).into_response();
        let (parts, body) = response.into_parts();
        assert_eq!(parts.status, StatusCode::NOT_FOUND);
        let body_bytes = axum::body::to_bytes(body, 1024).await.unwrap();
        let body_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(body_json["success"], false);
        assert_eq!(body_json["message"], "test item");
        assert!(body_json.get("data").is_none());
    }
}
