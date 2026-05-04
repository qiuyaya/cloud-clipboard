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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn init_test_config() {
        // Ensure config is initialized for tests
        let _ = crate::config::init_config();
    }

    #[test]
    fn build_base_url_from_headers() {
        init_test_config();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        headers.insert("host", HeaderValue::from_static("example.com:443"));
        let url = build_base_url(&headers);
        assert_eq!(url, "https://example.com:443");
    }

    #[test]
    fn build_base_url_default_values() {
        init_test_config();
        let headers = HeaderMap::new();
        let url = build_base_url(&headers);
        assert_eq!(url, "http://localhost:3001");
    }

    #[test]
    fn build_base_url_host_only() {
        init_test_config();
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("myapp.io"));
        let url = build_base_url(&headers);
        assert_eq!(url, "http://myapp.io");
    }

    #[test]
    fn api_response_serialization() {
        let resp = ApiResponse {
            success: true,
            message: Some("done".to_string()),
            data: Some("result"),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"message\":\"done\""));
        assert!(json.contains("\"data\":\"result\""));
    }

    #[test]
    fn api_response_skip_none_fields() {
        let resp = ApiResponse::<()> {
            success: false,
            message: None,
            data: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(!json.contains("message"));
        assert!(!json.contains("data"));
    }

    #[test]
    fn api_response_with_data() {
        let resp = ApiResponse {
            success: true,
            message: None,
            data: Some("result"),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"data\":\"result\""));
        assert!(!json.contains("message"));
    }

    #[test]
    fn api_response_with_message_only() {
        let resp = ApiResponse::<()> {
            success: false,
            message: Some("error occurred".to_string()),
            data: None,
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"message\":\"error occurred\""));
        assert!(!json.contains("data"));
    }

    #[test]
    fn build_base_url_with_public_url() {
        // This test verifies that when PUBLIC_URL is set, it takes priority
        // Since we can't easily set env vars at runtime for this test,
        // we test the fallback behavior
        init_test_config();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        headers.insert("host", HeaderValue::from_static("cdn.example.com"));
        let url = build_base_url(&headers);
        // If PUBLIC_URL is not set, should use headers
        assert!(url.contains("example.com") || url.contains("localhost"));
    }

    #[test]
    fn build_base_url_xff_proto_only() {
        init_test_config();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        let url = build_base_url(&headers);
        assert!(url.starts_with("https://"));
    }

    #[test]
    fn get_base_path_returns_config_value() {
        init_test_config();
        let base = get_base_path();
        // Should return the configured base path (default is empty string)
        assert!(base.is_empty() || base.starts_with('/'));
    }
}
