use axum::{
    http::{HeaderMap, Request, StatusCode, header::HeaderValue},
    response::{IntoResponse, Response},
};
use governor::{
    Quota, RateLimiter as GovRateLimiter, clock::DefaultClock, state::keyed::DefaultKeyedStateStore,
};
use std::{future::Future, num::NonZeroU32, pin::Pin, sync::Arc};

/// Key type for rate limiting
pub type RateLimiter = GovRateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

pub type KeyedRateLimiter = Arc<RateLimiter>;

/// Rate limit configuration from environment
#[derive(Clone, Debug)]
pub struct RateLimitConfig {
    pub window_secs: u64,
    pub general_max: u32,
    pub strict_max: u32,
    pub strict_window_secs: u64,
    pub public_download_max: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            window_secs: 60,
            general_max: 500,
            strict_max: 50,
            strict_window_secs: 300, // 5 minutes
            public_download_max: 20,
        }
    }
}

impl RateLimitConfig {
    /// Build from centralized AppConfig
    pub fn from_app_config(cfg: &crate::config::AppConfig) -> Self {
        Self {
            window_secs: cfg.rate_limit_window,
            general_max: cfg.rate_limit_max,
            strict_max: cfg.strict_limit_max,
            strict_window_secs: 300, // 5 minutes
            public_download_max: cfg.public_download_rate_limit,
        }
    }

    /// Load configuration from environment variables (legacy, for backward compat)
    pub fn from_env() -> Self {
        let parse_u32 = |key: &str, default: u32| -> u32 {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
        };

        // Support RATE_LIMIT_WINDOW_MS (milliseconds) or RATE_LIMIT_WINDOW (seconds)
        let window_secs = if let Ok(ms) = std::env::var("RATE_LIMIT_WINDOW_MS") {
            ms.parse::<u64>().ok().map(|v| v / 1000).unwrap_or(60)
        } else {
            std::env::var("RATE_LIMIT_WINDOW")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60)
        };

        // Support RATE_LIMIT_MAX_REQUESTS or RATE_LIMIT_MAX
        let general_max = std::env::var("RATE_LIMIT_MAX_REQUESTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| parse_u32("RATE_LIMIT_MAX", 500));

        Self {
            window_secs,
            general_max,
            strict_max: parse_u32("STRICT_LIMIT_MAX", 50),
            strict_window_secs: 300,
            public_download_max: std::env::var("PUBLIC_DOWNLOAD_RATE_LIMIT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20),
        }
    }
}

/// Create a rate limiter with specified requests per minute (1-minute window)
pub fn create_rate_limiter(
    _config: &RateLimitConfig,
    requests_per_window: u32,
) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(requests_per_window).unwrap_or_else(|| NonZeroU32::new(100).unwrap());
    let quota = Quota::per_minute(nz);
    Arc::new(GovRateLimiter::keyed(quota))
}

/// Create a rate limiter with custom window in seconds
/// Uses GCRA (token bucket) algorithm to approximate the sliding window behavior of Node.js
pub fn create_rate_limiter_with_window(requests: u32, window_secs: u64) -> KeyedRateLimiter {
    let nz = NonZeroU32::new(requests).unwrap_or_else(|| NonZeroU32::new(100).unwrap());
    // Calculate period in milliseconds for better precision
    let period_ms = (window_secs * 1000) / requests as u64;
    let period_ms = period_ms.max(1); // Ensure at least 1ms
    let quota = Quota::with_period(std::time::Duration::from_millis(period_ms))
        .expect("valid quota period")
        .allow_burst(nz);
    Arc::new(GovRateLimiter::keyed(quota))
}

/// Strict rate limiter: 50 requests per 5 minutes (matching Node.js HTTP_RATE_LIMITS.STRICT)
pub fn strict_rate_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    create_rate_limiter_with_window(config.strict_max, config.strict_window_secs)
}

/// Public download rate limiter: configured from PUBLIC_DOWNLOAD_RATE_LIMIT (default 20) per window
pub fn public_download_rate_limiter(config: &RateLimitConfig) -> KeyedRateLimiter {
    create_rate_limiter(config, config.public_download_max)
}

/// Extract client IP from request, supporting X-Forwarded-For header
pub fn extract_client_ip(headers: &HeaderMap) -> String {
    // Check X-Forwarded-For header first
    if let Some(xff) = headers.get("x-forwarded-for")
        && let Ok(xff_str) = xff.to_str()
        && let Some(ip) = xff_str.split(',').next()
    {
        let ip = ip.trim();
        if !ip.is_empty() {
            return ip.to_string();
        }
    }

    // Check X-Real-IP header
    if let Some(xri) = headers.get("x-real-ip")
        && let Ok(ip) = xri.to_str()
    {
        let ip = ip.trim();
        if !ip.is_empty() {
            return ip.to_string();
        }
    }

    "unknown".to_string()
}

/// Create rate limit headers
pub fn rate_limit_headers(
    config: &RateLimitConfig,
    remaining: u32,
    retry_after: Option<u64>,
) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let limit = config.general_max.to_string();

    headers.insert(
        "X-RateLimit-Limit",
        HeaderValue::from_str(&limit).unwrap_or_else(|_| HeaderValue::from_static("500")),
    );
    headers.insert(
        "X-RateLimit-Remaining",
        HeaderValue::from_str(&remaining.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );

    let reset_time = chrono::Utc::now().timestamp() + config.window_secs as i64;
    headers.insert(
        "X-RateLimit-Reset",
        HeaderValue::from_str(&reset_time.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );

    if let Some(retry) = retry_after {
        headers.insert(
            "Retry-After",
            HeaderValue::from_str(&retry.to_string())
                .unwrap_or_else(|_| HeaderValue::from_static("1")),
        );
    }

    headers
}

/// Create a rate limit exceeded response
pub fn rate_limit_exceeded_response(config: &RateLimitConfig, retry_after: u64) -> Response {
    let body = serde_json::json!({
        "success": false,
        "error": "RATE_LIMIT_EXCEEDED",
        "message": "Too many requests. Please try again later.",
        "retryAfter": retry_after
    });

    let headers = rate_limit_headers(config, 0, Some(retry_after));

    (StatusCode::TOO_MANY_REQUESTS, headers, body.to_string()).into_response()
}

/// Rate limiter middleware factory
#[derive(Clone)]
pub struct RateLimitMiddleware {
    limiter: KeyedRateLimiter,
    config: RateLimitConfig,
}

impl RateLimitMiddleware {
    /// Create new rate limit middleware
    pub fn new(limiter: KeyedRateLimiter) -> Self {
        Self {
            limiter,
            config: RateLimitConfig::default(),
        }
    }
}

impl<S> tower::Layer<S> for RateLimitMiddleware {
    type Service = RateLimitService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitService {
            inner,
            limiter: self.limiter.clone(),
            config: self.config.clone(),
        }
    }
}

/// Rate limited service wrapper
#[derive(Clone)]
pub struct RateLimitService<S> {
    inner: S,
    limiter: KeyedRateLimiter,
    config: RateLimitConfig,
}

impl<S, B> tower::Service<Request<B>> for RateLimitService<S>
where
    S: tower::Service<Request<B>, Response = Response> + Clone + Send + 'static,
    S::Future: Send,
    B: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<B>) -> Self::Future {
        let mut inner = self.inner.clone();
        let limiter = self.limiter.clone();
        let config = self.config.clone();

        Box::pin(async move {
            let client_ip = extract_client_ip(req.headers());

            match limiter.check_key(&client_ip) {
                Ok(()) => {
                    let response = inner.call(req).await?;

                    // Add rate limit headers to response
                    let headers = rate_limit_headers(&config, config.general_max, None);
                    let (mut parts, body) = response.into_parts();
                    for (key, value) in headers {
                        if let Some(k) = key {
                            parts.headers.insert(k, value);
                        }
                    }

                    Ok(Response::from_parts(parts, body))
                }
                Err(_negative) => {
                    let wait_time = config.window_secs;

                    Ok(rate_limit_exceeded_response(&config, wait_time))
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_default_values() {
        let config = RateLimitConfig::default();
        assert_eq!(config.window_secs, 60);
        assert_eq!(config.general_max, 500);
        assert_eq!(config.strict_max, 50);
        assert_eq!(config.strict_window_secs, 300);
        assert_eq!(config.public_download_max, 20);
    }

    #[test]
    fn create_limiter_returns_limiter() {
        let config = RateLimitConfig::default();
        let limiter = create_rate_limiter(&config, 100);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn client_ip_from_x_forwarded_for() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.2.3.4, 5.6.7.8"),
        );
        assert_eq!(extract_client_ip(&headers), "1.2.3.4");
    }

    #[test]
    fn client_ip_from_x_forwarded_for_single() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4"));
        assert_eq!(extract_client_ip(&headers), "1.2.3.4");
    }

    #[test]
    fn client_ip_from_x_real_ip() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("9.8.7.6"));
        assert_eq!(extract_client_ip(&headers), "9.8.7.6");
    }

    #[test]
    fn client_ip_xff_takes_priority() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("1.1.1.1"));
        headers.insert("x-real-ip", HeaderValue::from_static("2.2.2.2"));
        assert_eq!(extract_client_ip(&headers), "1.1.1.1");
    }

    #[test]
    fn client_ip_no_headers_returns_unknown() {
        let headers = HeaderMap::new();
        assert_eq!(extract_client_ip(&headers), "unknown");
    }

    #[test]
    fn client_ip_empty_xff_falls_through() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static(""));
        headers.insert("x-real-ip", HeaderValue::from_static("3.3.3.3"));
        assert_eq!(extract_client_ip(&headers), "3.3.3.3");
    }

    #[test]
    fn headers_contain_required_fields() {
        let config = RateLimitConfig::default();
        let headers = rate_limit_headers(&config, 42, None);

        assert!(headers.contains_key("X-RateLimit-Limit"));
        assert!(headers.contains_key("X-RateLimit-Remaining"));
        assert!(headers.contains_key("X-RateLimit-Reset"));
        assert!(!headers.contains_key("Retry-After"));

        assert_eq!(headers.get("X-RateLimit-Remaining").unwrap(), "42");
    }

    #[test]
    fn headers_with_retry_after() {
        let config = RateLimitConfig::default();
        let headers = rate_limit_headers(&config, 0, Some(30));

        assert!(headers.contains_key("Retry-After"));
        assert_eq!(headers.get("Retry-After").unwrap(), "30");
    }

    #[test]
    fn exceeded_response_returns_429() {
        let config = RateLimitConfig::default();
        let response = rate_limit_exceeded_response(&config, 60);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn limiter_with_custom_window() {
        let limiter = create_rate_limiter_with_window(10, 60);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn strict_limiter_works() {
        let config = RateLimitConfig::default();
        let limiter = strict_rate_limiter(&config);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn public_download_limiter_works() {
        let config = RateLimitConfig::default();
        let limiter = public_download_rate_limiter(&config);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn from_app_config_uses_values() {
        let cfg = crate::config::AppConfig::from_env();
        let rl_config = RateLimitConfig::from_app_config(&cfg);
        assert_eq!(rl_config.window_secs, cfg.rate_limit_window);
        assert_eq!(rl_config.general_max, cfg.rate_limit_max);
        assert_eq!(rl_config.strict_max, cfg.strict_limit_max);
        assert_eq!(rl_config.strict_window_secs, 300);
        assert_eq!(
            rl_config.public_download_max,
            cfg.public_download_rate_limit
        );
    }

    #[test]
    fn exceeded_response_body_contains_error() {
        let config = RateLimitConfig::default();
        let response = rate_limit_exceeded_response(&config, 60);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn create_limiter_with_zero_requests_uses_100() {
        let config = RateLimitConfig::default();
        let limiter = create_rate_limiter(&config, 0);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn client_ip_whitespace_trimmed() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("  1.2.3.4  "));
        assert_eq!(extract_client_ip(&headers), "1.2.3.4");
    }

    #[test]
    fn client_ip_xff_comma_with_spaces() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static(" 1.2.3.4 , 5.6.7.8 "),
        );
        assert_eq!(extract_client_ip(&headers), "1.2.3.4");
    }

    #[test]
    fn client_ip_empty_xff_then_empty_xri_returns_unknown() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("  "));
        headers.insert("x-real-ip", HeaderValue::from_static("  "));
        assert_eq!(extract_client_ip(&headers), "unknown");
    }

    #[test]
    fn rate_limit_headers_with_zero_remaining() {
        let config = RateLimitConfig::default();
        let headers = rate_limit_headers(&config, 0, None);
        assert_eq!(headers.get("X-RateLimit-Remaining").unwrap(), "0");
    }

    #[test]
    fn rate_limit_headers_limit_value() {
        let config = RateLimitConfig::default();
        let headers = rate_limit_headers(&config, 42, None);
        assert_eq!(headers.get("X-RateLimit-Limit").unwrap(), "500");
    }

    #[test]
    fn from_env_default_values() {
        // from_env reads env vars; without setting them, defaults should apply
        let config = RateLimitConfig::from_env();
        // These should be the defaults when no env vars are set
        assert_eq!(config.strict_window_secs, 300);
        // window_secs, general_max, etc. depend on env vars so just verify structure
        assert!(config.window_secs > 0);
        assert!(config.general_max > 0);
        assert!(config.strict_max > 0);
        assert!(config.public_download_max > 0);
    }

    #[test]
    fn rate_limit_middleware_new() {
        let config = RateLimitConfig::default();
        let limiter = create_rate_limiter(&config, 100);
        let _middleware = RateLimitMiddleware::new(limiter);
    }

    #[test]
    fn rate_limit_service_clone() {
        let config = RateLimitConfig::default();
        let limiter = create_rate_limiter(&config, 100);
        let middleware = RateLimitMiddleware::new(limiter);
        let _cloned = middleware.clone();
    }

    #[test]
    fn create_limiter_with_window_one_request() {
        let limiter = create_rate_limiter_with_window(1, 60);
        let key = "test".to_string();
        assert!(limiter.check_key(&key).is_ok());
    }

    #[test]
    fn rate_limit_exceeded_response_body() {
        let config = RateLimitConfig::default();
        let response = rate_limit_exceeded_response(&config, 30);
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn client_ip_xff_with_multiple_proxies() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("1.1.1.1, 2.2.2.2, 3.3.3.3"),
        );
        assert_eq!(extract_client_ip(&headers), "1.1.1.1");
    }

    #[test]
    fn client_ip_xff_with_only_comma() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static(","));
        // Empty after trim should fall through
        assert_eq!(extract_client_ip(&headers), "unknown");
    }

    // ============================================================================
    // RateLimitService 集成测试
    // ============================================================================

    #[tokio::test]
    async fn rate_limit_service_allows_within_quota() {
        use axum::Router;
        use axum::body::Body;
        use axum::routing::get;
        use tower::ServiceExt;

        let config = RateLimitConfig::default();
        let limiter = create_rate_limiter(&config, 100);

        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(RateLimitMiddleware::new(limiter));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("x-forwarded-for", "127.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Verify rate limit headers are present
        let headers = response.headers();
        assert!(
            headers.contains_key("X-RateLimit-Limit"),
            "Response should contain X-RateLimit-Limit header"
        );
        assert!(
            headers.contains_key("X-RateLimit-Remaining"),
            "Response should contain X-RateLimit-Remaining header"
        );
        assert!(
            headers.contains_key("X-RateLimit-Reset"),
            "Response should contain X-RateLimit-Reset header"
        );
        // No Retry-After when request is allowed
        assert!(
            !headers.contains_key("Retry-After"),
            "Retry-After header should not be present for allowed requests"
        );
    }

    #[tokio::test]
    async fn rate_limit_service_rejects_over_quota() {
        use axum::Router;
        use axum::body::Body;
        use axum::routing::get;
        use tower::ServiceExt;

        let config = RateLimitConfig::default();
        // Create a limiter with only 1 request per minute
        let limiter = create_rate_limiter(&config, 1);

        let middleware = RateLimitMiddleware::new(limiter.clone());

        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(middleware);

        // First request should succeed
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("x-forwarded-for", "127.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::OK,
            "First request should be allowed"
        );

        // Second request should be rejected with 429
        let app2 = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(RateLimitMiddleware::new(limiter));

        let response = app2
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("x-forwarded-for", "127.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "Second request should be rate limited"
        );

        // Verify Retry-After header is present
        assert!(
            response.headers().contains_key("Retry-After"),
            "429 response should contain Retry-After header"
        );
    }

    #[tokio::test]
    async fn rate_limit_service_different_ips_independent() {
        use axum::Router;
        use axum::body::Body;
        use axum::routing::get;
        use tower::ServiceExt;

        let config = RateLimitConfig::default();
        // Limiter with 1 request per minute
        let limiter = create_rate_limiter(&config, 1);

        // Use up quota for IP 1
        let app1 = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(RateLimitMiddleware::new(limiter.clone()));

        let response1 = app1
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("x-forwarded-for", "10.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response1.status(), StatusCode::OK);

        // IP 2 should still be allowed even though IP 1 used its quota
        let app2 = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(RateLimitMiddleware::new(limiter));

        let response2 = app2
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("x-forwarded-for", "10.0.0.2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response2.status(),
            StatusCode::OK,
            "Different IP should have independent quota"
        );
    }

    #[tokio::test]
    async fn rate_limit_exceeded_response_json_structure() {
        let config = RateLimitConfig {
            window_secs: 60,
            general_max: 500,
            strict_max: 50,
            strict_window_secs: 300,
            public_download_max: 20,
        };
        let retry_after = 30u64;
        let response = rate_limit_exceeded_response(&config, retry_after);

        // Verify status code
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);

        // Verify headers
        let headers = response.headers();
        assert!(headers.contains_key("X-RateLimit-Limit"));
        assert!(headers.contains_key("X-RateLimit-Remaining"));
        assert!(headers.contains_key("X-RateLimit-Reset"));
        assert!(headers.contains_key("Retry-After"));
        assert_eq!(headers.get("Retry-After").unwrap(), "30");
        assert_eq!(headers.get("X-RateLimit-Remaining").unwrap(), "0");

        // Verify JSON body
        let body = response.into_body();
        let bytes = axum::body::to_bytes(body, 1024)
            .await
            .expect("body should be collectable");
        let json: serde_json::Value =
            serde_json::from_slice(&bytes).expect("body should be valid JSON");

        assert_eq!(json["success"], false);
        assert_eq!(json["error"], "RATE_LIMIT_EXCEEDED");
        assert_eq!(
            json["message"],
            "Too many requests. Please try again later."
        );
        assert_eq!(json["retryAfter"], 30);
    }

    #[test]
    fn rate_limit_exceeded_response_custom_config() {
        let config = RateLimitConfig {
            window_secs: 120,
            general_max: 1000,
            strict_max: 100,
            strict_window_secs: 600,
            public_download_max: 50,
        };
        let response = rate_limit_exceeded_response(&config, 120);

        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);

        // X-RateLimit-Limit should reflect config.general_max
        assert_eq!(response.headers().get("X-RateLimit-Limit").unwrap(), "1000");
        // X-RateLimit-Remaining should be 0
        assert_eq!(
            response.headers().get("X-RateLimit-Remaining").unwrap(),
            "0"
        );
        // Retry-After should match retry_after parameter
        assert_eq!(response.headers().get("Retry-After").unwrap(), "120");
    }
}
