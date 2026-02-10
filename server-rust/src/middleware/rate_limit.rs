use axum::{
    response::{Response, IntoResponse},
    http::{Request, StatusCode, HeaderMap, header::HeaderValue},
};
use governor::{Quota, RateLimiter as GovRateLimiter, clock::DefaultClock, state::keyed::DefaultKeyedStateStore};
use std::{
    num::NonZeroU32,
    sync::Arc,
    future::Future,
    pin::Pin,
};

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
    /// Load configuration from environment variables
    pub fn from_env() -> Self {
        let parse_u32 = |key: &str, default: u32| -> u32 {
            std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
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
pub fn create_rate_limiter(_config: &RateLimitConfig, requests_per_window: u32) -> KeyedRateLimiter {
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
    if let Some(xff) = headers.get("x-forwarded-for") {
        if let Ok(xff_str) = xff.to_str() {
            if let Some(ip) = xff_str.split(',').next() {
                let ip = ip.trim();
                if !ip.is_empty() {
                    return ip.to_string();
                }
            }
        }
    }

    // Check X-Real-IP header
    if let Some(xri) = headers.get("x-real-ip") {
        if let Ok(ip) = xri.to_str() {
            let ip = ip.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }

    "unknown".to_string()
}

/// Create rate limit headers
pub fn rate_limit_headers(config: &RateLimitConfig, remaining: u32, retry_after: Option<u64>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let limit = config.general_max.to_string();

    headers.insert(
        "X-RateLimit-Limit",
        HeaderValue::from_str(&limit).unwrap_or_else(|_| HeaderValue::from_static("500"))
    );
    headers.insert(
        "X-RateLimit-Remaining",
        HeaderValue::from_str(&remaining.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0"))
    );

    let reset_time = chrono::Utc::now().timestamp() + config.window_secs as i64;
    headers.insert(
        "X-RateLimit-Reset",
        HeaderValue::from_str(&reset_time.to_string()).unwrap_or_else(|_| HeaderValue::from_static("0"))
    );

    if let Some(retry) = retry_after {
        headers.insert(
            "Retry-After",
            HeaderValue::from_str(&retry.to_string()).unwrap_or_else(|_| HeaderValue::from_static("1"))
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
