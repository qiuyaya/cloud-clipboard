pub mod health;
pub mod api_info;
pub mod rooms;
pub mod files;
pub mod share;

use axum::http::HeaderMap;
use serde::Serialize;

/// Unified API response type used across all route modules
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

/// Build base URL from PUBLIC_URL env var or request headers for constructing absolute URLs
/// Priority: PUBLIC_URL > request headers (X-Forwarded-Proto + Host)
pub fn build_base_url(headers: &HeaderMap) -> String {
    if let Ok(public_url) = std::env::var("PUBLIC_URL") {
        return public_url.trim_end_matches('/').to_string();
    }
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:3001");
    format!("{}://{}", proto, host)
}
