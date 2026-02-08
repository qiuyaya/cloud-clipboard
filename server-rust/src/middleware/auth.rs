use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Extractor that validates the x-room-key header
pub struct AuthenticatedRoom(pub String);

#[derive(Serialize)]
struct ErrorResponse {
    success: bool,
    message: String,
}

impl<S> FromRequestParts<S> for AuthenticatedRoom
where
    S: Send + Sync,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let room_key = parts
            .headers
            .get("x-room-key")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        match room_key {
            Some(key) if !key.is_empty() => Ok(AuthenticatedRoom(key)),
            _ => Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    success: false,
                    message: "Missing x-room-key header".to_string(),
                }),
            )
                .into_response()),
        }
    }
}
