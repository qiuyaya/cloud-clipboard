pub mod api_info;
pub mod files;
pub mod health;
pub mod rooms;
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

/// Get BASE_PATH from centralized config
pub fn get_base_path() -> &'static str {
    &crate::config::config().base_path
}

/// Build base URL from PUBLIC_URL config or request headers for constructing absolute URLs
/// Priority: PUBLIC_URL > request headers (X-Forwarded-Proto + Host)
pub fn build_base_url(headers: &HeaderMap) -> String {
    let cfg = crate::config::config();
    if let Some(ref public_url) = cfg.public_url {
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
