use governor::{Quota, RateLimiter as GovRateLimiter, state::keyed::DefaultKeyedStateStore};
use std::num::NonZeroU32;
use std::sync::Arc;

pub type KeyedRateLimiter = Arc<GovRateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>>;

/// Create a rate limiter with specified requests per minute
pub fn create_rate_limiter(requests_per_minute: u32) -> KeyedRateLimiter {
    let quota = Quota::per_minute(NonZeroU32::new(requests_per_minute).unwrap());
    Arc::new(GovRateLimiter::keyed(quota))
}

/// General rate limiter: 100 requests per minute
pub fn general_rate_limiter() -> KeyedRateLimiter {
    create_rate_limiter(100)
}

/// Strict rate limiter: 20 requests per minute
pub fn strict_rate_limiter() -> KeyedRateLimiter {
    create_rate_limiter(20)
}

/// Share creation rate limiter: 10 per minute
pub fn share_rate_limiter() -> KeyedRateLimiter {
    create_rate_limiter(10)
}

/// Public download rate limiter: 100 per minute per IP
pub fn download_rate_limiter() -> KeyedRateLimiter {
    create_rate_limiter(100)
}

pub struct RateLimiter;

impl RateLimiter {
    pub fn check(limiter: &KeyedRateLimiter, key: &str) -> bool {
        limiter.check_key(&key.to_string()).is_ok()
    }
}
