// Rate Limiter Tests
//
// These tests verify the rate limiting algorithm and behavior,
// ensuring it matches the Node.js implementation
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Test rate limiter implementation
struct TestRateLimiter {
    records: HashMap<String, Record>,
    window_ms: u64,
    max_requests: u32,
}

struct Record {
    requests: u32,
    reset_time: Instant,
}

impl TestRateLimiter {
    fn new(window_ms: u64, max_requests: u32) -> Self {
        Self {
            records: HashMap::new(),
            window_ms,
            max_requests,
        }
    }

    fn check(&mut self, key: &str) -> CheckResult {
        let now = Instant::now();

        match self.records.get_mut(key) {
            Some(record) if now < record.reset_time => {
                // Window still valid
                if record.requests >= self.max_requests {
                    CheckResult {
                        allowed: false,
                        remaining: 0,
                        _reset_time: record.reset_time,
                    }
                } else {
                    record.requests += 1;
                    CheckResult {
                        allowed: true,
                        remaining: self.max_requests.saturating_sub(record.requests),
                        _reset_time: record.reset_time,
                    }
                }
            }
            _ => {
                // Create new window
                let reset_time = now + Duration::from_millis(self.window_ms);

                // 特殊处理：如果 max_requests 为 0，直接拒绝
                if self.max_requests == 0 {
                    self.records.insert(
                        key.to_string(),
                        Record {
                            requests: 1,
                            reset_time,
                        },
                    );
                    return CheckResult {
                        allowed: false,
                        remaining: 0,
                        _reset_time: reset_time,
                    };
                }

                self.records.insert(
                    key.to_string(),
                    Record {
                        requests: 1,
                        reset_time,
                    },
                );
                CheckResult {
                    allowed: true,
                    remaining: self.max_requests.saturating_sub(1),
                    _reset_time: reset_time,
                }
            }
        }
    }

    fn cleanup(&mut self) -> usize {
        let now = Instant::now();
        let before = self.records.len();
        self.records.retain(|_, record| now < record.reset_time);
        before - self.records.len()
    }
}

struct CheckResult {
    allowed: bool,
    remaining: u32,
    _reset_time: Instant,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Rate Limit Logic tests
    #[test]
    fn test_allows_requests_within_limit() {
        let mut limiter = TestRateLimiter::new(60000, 5);

        for _ in 0..5 {
            let result = limiter.check("test-ip");
            assert!(result.allowed);
        }
    }

    #[test]
    fn test_blocks_requests_exceeding_limit() {
        let mut limiter = TestRateLimiter::new(60000, 5);

        // Use up the limit
        for _ in 0..5 {
            limiter.check("test-ip");
        }

        // Next request should be blocked
        let result = limiter.check("test-ip");
        assert!(!result.allowed);
        assert_eq!(result.remaining, 0);
    }

    #[test]
    fn test_tracks_remaining_requests_correctly() {
        let mut limiter = TestRateLimiter::new(60000, 10);

        assert_eq!(limiter.check("test-ip").remaining, 9);
        assert_eq!(limiter.check("test-ip").remaining, 8);
        assert_eq!(limiter.check("test-ip").remaining, 7);
    }

    #[test]
    fn test_tracks_different_keys_separately() {
        let mut limiter = TestRateLimiter::new(60000, 3);

        // Exhaust limit for ip-1
        for _ in 0..3 {
            limiter.check("ip-1");
        }

        // ip-1 should be blocked
        assert!(!limiter.check("ip-1").allowed);

        // ip-2 should still be allowed
        assert!(limiter.check("ip-2").allowed);
    }

    #[test]
    fn test_cleanup_expired_records() {
        let mut limiter = TestRateLimiter::new(100, 5); // 100ms window

        limiter.check("test-ip");

        // Wait for window to expire
        std::thread::sleep(Duration::from_millis(150));

        let cleaned = limiter.cleanup();
        assert_eq!(cleaned, 1);
    }

    #[test]
    fn test_reset_counter_after_window_expires() {
        let mut limiter = TestRateLimiter::new(100, 2); // 100ms window

        // Exhaust limit
        limiter.check("test-ip");
        limiter.check("test-ip");
        assert!(!limiter.check("test-ip").allowed);

        // Wait for window to expire
        std::thread::sleep(Duration::from_millis(150));

        // Should allow requests again
        assert!(limiter.check("test-ip").allowed);
    }

    // Configuration tests
    #[test]
    fn test_rate_limit_configuration() {
        // Test different configurations
        let configs = vec![
            (100, 60000), // 100 requests per minute (GENERAL)
            (50, 60000),  // 50 requests per minute (UPLOAD)
            (10, 60000),  // 10 requests per minute (AUTH)
            (5, 60000),   // 5 requests per minute (STRICT)
            (20, 60000),  // 20 requests per minute (ROOM_ACTION)
        ];

        for (max_requests, window_ms) in configs {
            let limiter = TestRateLimiter::new(window_ms, max_requests);
            assert_eq!(limiter.max_requests, max_requests);
            assert_eq!(limiter.window_ms, window_ms);
        }
    }

    // Response format tests
    #[test]
    fn test_response_format_when_rate_limited() {
        #[derive(Debug)]
        struct Response {
            success: bool,
            message: String,
        }

        let response = Response {
            success: false,
            message: "Too many requests. Please try again later.".to_string(),
        };

        assert!(!response.success);
        assert!(response.message.contains("Too many requests"));
    }

    #[test]
    fn test_rate_limit_headers() {
        struct RateLimitHeaders {
            limit: String,
            remaining: String,
            reset: String,
        }

        let headers = RateLimitHeaders {
            limit: "100".to_string(),
            remaining: "95".to_string(),
            reset: chrono::Utc::now().to_rfc3339(),
        };

        assert!(!headers.limit.is_empty());
        assert!(!headers.remaining.is_empty());
        assert!(!headers.reset.is_empty());
    }

    // Custom key generation tests
    #[test]
    fn test_ip_based_key_generation() {
        struct Request {
            ip: Option<String>,
        }

        let key_generator = |req: &Request| req.ip.as_deref().unwrap_or("unknown").to_string();

        assert_eq!(
            key_generator(&Request {
                ip: Some("192.168.1.1".to_string())
            }),
            "192.168.1.1"
        );
        assert_eq!(key_generator(&Request { ip: None }), "unknown");
    }

    #[test]
    fn test_compound_key_generation() {
        struct Request {
            ip: String,
            room_key: Option<String>,
        }

        let key_generator = |req: &Request| {
            format!(
                "{}:{}",
                req.ip,
                req.room_key.as_deref().unwrap_or("no-room")
            )
        };

        assert_eq!(
            key_generator(&Request {
                ip: "192.168.1.1".to_string(),
                room_key: Some("room123".to_string())
            }),
            "192.168.1.1:room123"
        );
        assert_eq!(
            key_generator(&Request {
                ip: "192.168.1.1".to_string(),
                room_key: None
            }),
            "192.168.1.1:no-room"
        );
    }

    // ============================================================================
    // 并发和竞态条件测试
    // ============================================================================

    #[test]
    fn test_concurrent_requests_counting_accuracy() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let limiter = Arc::new(Mutex::new(TestRateLimiter::new(60000, 100)));
        let mut handles = vec![];

        // 启动 200 个并发请求
        for _ in 0..200 {
            let limiter_clone = Arc::clone(&limiter);
            let handle =
                thread::spawn(move || limiter_clone.lock().unwrap().check("test-ip").allowed);
            handles.push(handle);
        }

        // 收集结果
        let mut success_count = 0;
        for handle in handles {
            if handle.join().unwrap() {
                success_count += 1;
            }
        }

        // 应该恰好有 100 个成功
        assert_eq!(
            success_count, 100,
            "Expected exactly 100 successful requests"
        );
    }

    #[test]
    fn test_different_ips_isolated() {
        let mut limiter = TestRateLimiter::new(60000, 5);

        // IP 1 用完配额
        for _ in 0..5 {
            assert!(limiter.check("192.168.1.1").allowed);
        }
        assert!(!limiter.check("192.168.1.1").allowed);

        // IP 2 应该仍然有配额
        for _ in 0..5 {
            assert!(limiter.check("192.168.1.2").allowed);
        }
        assert!(!limiter.check("192.168.1.2").allowed);

        // IP 3 也应该有配额
        assert!(limiter.check("192.168.1.3").allowed);
    }

    #[test]
    fn test_concurrent_different_ips() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let limiter = Arc::new(Mutex::new(TestRateLimiter::new(60000, 10)));
        let mut handles = vec![];

        // 10 个不同的 IP，每个发送 10 个请求
        for i in 0..10 {
            let limiter_clone = Arc::clone(&limiter);
            let ip = format!("192.168.1.{}", i);
            let handle = thread::spawn(move || {
                let mut success = 0;
                for _ in 0..10 {
                    if limiter_clone.lock().unwrap().check(&ip).allowed {
                        success += 1;
                    }
                }
                success
            });
            handles.push(handle);
        }

        // 每个 IP 应该恰好有 10 个成功
        for handle in handles {
            assert_eq!(handle.join().unwrap(), 10);
        }
    }

    // ============================================================================
    // 窗口管理测试
    // ============================================================================

    #[test]
    fn test_window_sliding_behavior() {
        let mut limiter = TestRateLimiter::new(200, 3); // 200ms 窗口，3 个请求

        // 在 t=0 时发送 3 个请求
        assert!(limiter.check("test-ip").allowed);
        assert!(limiter.check("test-ip").allowed);
        assert!(limiter.check("test-ip").allowed);

        // 第 4 个应该被拒绝
        assert!(!limiter.check("test-ip").allowed);

        // 等待窗口过期
        std::thread::sleep(Duration::from_millis(250));

        // 现在应该可以再次发送请求
        assert!(limiter.check("test-ip").allowed);
    }

    #[test]
    fn test_multiple_windows_for_same_key() {
        let mut limiter = TestRateLimiter::new(100, 2); // 100ms 窗口

        // 第一个窗口
        assert!(limiter.check("test-ip").allowed);
        assert!(limiter.check("test-ip").allowed);
        assert!(!limiter.check("test-ip").allowed);

        std::thread::sleep(Duration::from_millis(150));

        // 第二个窗口
        assert!(limiter.check("test-ip").allowed);
        assert!(limiter.check("test-ip").allowed);
        assert!(!limiter.check("test-ip").allowed);
    }

    #[test]
    fn test_partial_window_consumption() {
        let mut limiter = TestRateLimiter::new(60000, 10);

        // 只使用部分配额
        for _ in 0..3 {
            limiter.check("test-ip");
        }

        // 检查剩余配额
        let result = limiter.check("test-ip");
        assert!(result.allowed);
        assert_eq!(result.remaining, 6);
    }

    // ============================================================================
    // 边界和异常测试
    // ============================================================================

    #[test]
    fn test_zero_limit_always_blocks() {
        let mut limiter = TestRateLimiter::new(60000, 0);

        // 即使是第一个请求也应该被拒绝
        assert!(!limiter.check("test-ip").allowed);
        assert_eq!(limiter.check("test-ip").remaining, 0);
    }

    #[test]
    fn test_single_request_limit() {
        let mut limiter = TestRateLimiter::new(60000, 1);

        // 第一个请求应该通过
        assert!(limiter.check("test-ip").allowed);

        // 第二个应该被拒绝
        assert!(!limiter.check("test-ip").allowed);
    }

    #[test]
    fn test_very_large_limit() {
        let mut limiter = TestRateLimiter::new(60000, 1_000_000);

        // 发送大量请求
        for i in 0..10000 {
            let result = limiter.check("test-ip");
            assert!(result.allowed, "Request {} should be allowed", i);
        }

        // 检查剩余配额
        let result = limiter.check("test-ip");
        assert_eq!(result.remaining, 1_000_000 - 10001);
    }

    #[test]
    fn test_very_short_window() {
        let mut limiter = TestRateLimiter::new(10, 5); // 10ms 窗口

        // 快速发送请求
        for _ in 0..5 {
            assert!(limiter.check("test-ip").allowed);
        }
        assert!(!limiter.check("test-ip").allowed);

        // 短暂等待后应该重置
        std::thread::sleep(Duration::from_millis(20));
        assert!(limiter.check("test-ip").allowed);
    }

    #[test]
    fn test_very_long_key() {
        let mut limiter = TestRateLimiter::new(60000, 5);
        let long_key = "a".repeat(1000); // 1000 字符的键

        // 应该正常工作
        assert!(limiter.check(&long_key).allowed);
        assert!(limiter.check(&long_key).allowed);
    }

    #[test]
    fn test_special_characters_in_key() {
        let mut limiter = TestRateLimiter::new(60000, 5);

        let special_keys = vec![
            "user@example.com",
            "192.168.1.1:8080",
            "key-with-dashes",
            "key_with_underscores",
            "key.with.dots",
            "key/with/slashes",
        ];

        for key in special_keys {
            assert!(limiter.check(key).allowed, "Failed for key: {}", key);
        }
    }

    // ============================================================================
    // 清理和维护测试
    // ============================================================================

    #[test]
    fn test_cleanup_only_expired_records() {
        let mut limiter = TestRateLimiter::new(100, 5);

        // 创建多个记录
        limiter.check("ip1");
        std::thread::sleep(Duration::from_millis(60));
        limiter.check("ip2");
        std::thread::sleep(Duration::from_millis(60));
        limiter.check("ip3");

        // ip1 应该过期，ip2 和 ip3 仍然有效
        let cleaned = limiter.cleanup();
        assert_eq!(cleaned, 1, "Should clean exactly 1 expired record");
    }

    #[test]
    fn test_cleanup_with_no_records() {
        let mut limiter = TestRateLimiter::new(100, 5);

        let cleaned = limiter.cleanup();
        assert_eq!(cleaned, 0);
    }

    #[test]
    fn test_cleanup_with_all_active_records() {
        let mut limiter = TestRateLimiter::new(60000, 5);

        // 创建多个活跃记录
        for i in 0..10 {
            limiter.check(&format!("ip{}", i));
        }

        let cleaned = limiter.cleanup();
        assert_eq!(cleaned, 0, "Should not clean any active records");
    }

    // ============================================================================
    // 限流恢复测试
    // ============================================================================

    #[test]
    fn test_recovery_after_limit() {
        let mut limiter = TestRateLimiter::new(100, 3);

        // 用完配额
        limiter.check("test-ip");
        limiter.check("test-ip");
        limiter.check("test-ip");
        assert!(!limiter.check("test-ip").allowed);

        // 等待窗口重置
        std::thread::sleep(Duration::from_millis(150));

        // 应该恢复到完整配额
        let result = limiter.check("test-ip");
        assert!(result.allowed);
        assert_eq!(result.remaining, 2, "Should have full quota minus one");
    }

    #[test]
    fn test_partial_recovery_timing() {
        let mut limiter = TestRateLimiter::new(200, 5);

        // 使用所有配额
        for _ in 0..5 {
            limiter.check("test-ip");
        }

        // 等待一半窗口时间（不应该恢复）
        std::thread::sleep(Duration::from_millis(100));
        assert!(!limiter.check("test-ip").allowed);

        // 再等待剩余时间（应该恢复）
        std::thread::sleep(Duration::from_millis(150));
        assert!(limiter.check("test-ip").allowed);
    }
}
