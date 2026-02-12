/// 公共测试工具模块
///
/// 提供测试中常用的工厂函数、断言辅助和性能测量工具

use cloud_clipboard_server::models::{User, Message, message::{MessageType, MessageSender}};
use cloud_clipboard_server::services::{RoomService, room_service::JoinRoomRequest};
use std::sync::Arc;
use chrono::Utc;

// ============================================================================
// 测试数据工厂
// ============================================================================

pub struct TestDataFactory;

impl TestDataFactory {
    /// 创建测试用户
    pub fn create_user(id: &str, name: &str, room_key: &str) -> User {
        User::new(id.to_string(), name.to_string(), room_key.to_string())
    }

    /// 创建带有多个用户的房间
    pub fn create_room_with_users(
        service: Arc<RoomService>,
        room_key: &str,
        user_count: usize,
    ) -> Vec<User> {
        let mut users = vec![];
        for i in 0..user_count {
            let (user, _) = service
                .join_room(
                    JoinRoomRequest::new(
                        room_key,
                        &format!("user{}", i),
                        &format!("User{}", i),
                        &format!("socket{}", i),
                    )
                    .with_fingerprint(&format!("fp{}", i)),
                )
                .unwrap();
            users.push(user);
        }
        users
    }

    /// 创建测试消息
    pub fn create_message(user: &User, room_key: &str, content: &str) -> Message {
        Message {
            id: uuid::Uuid::new_v4().to_string(),
            message_type: MessageType::Text,
            content: Some(content.to_string()),
            sender: MessageSender::from_user(user),
            timestamp: Utc::now(),
            room_key: room_key.to_string(),
            file_id: None,
            file_info: None,
            download_url: None,
        }
    }

    /// 创建文件消息
    pub fn create_file_message(
        user: &User,
        room_key: &str,
        file_name: &str,
        file_size: u64,
    ) -> Message {
        Message {
            id: uuid::Uuid::new_v4().to_string(),
            message_type: MessageType::File,
            content: None,
            sender: MessageSender::from_user(user),
            timestamp: Utc::now(),
            room_key: room_key.to_string(),
            file_id: Some(format!("{}-{}", Utc::now().timestamp_millis(), file_name)),
            file_info: Some(serde_json::json!({
                "name": file_name,
                "size": file_size,
            })),
            download_url: Some(format!("/api/files/{}", file_name)),
        }
    }

    /// 创建带密码的房间
    pub fn create_room_with_password(
        service: Arc<RoomService>,
        room_key: &str,
        password: &str,
    ) -> Result<(), String> {
        service.create_room(room_key, Some(password))?;
        Ok(())
    }
}

// ============================================================================
// 断言辅助函数
// ============================================================================

pub mod assertions {
    use cloud_clipboard_server::models::User;

    /// 断言两个用户相等
    pub fn assert_users_equal(a: &User, b: &User) {
        assert_eq!(a.id, b.id, "User IDs should match");
        assert_eq!(a.username, b.username, "Usernames should match");
        assert_eq!(a.room_key, b.room_key, "Room keys should match");
    }

    /// 断言用户在线状态
    pub fn assert_user_online(user: &User) {
        assert!(user.is_online, "User should be online");
    }

    /// 断言用户离线状态
    pub fn assert_user_offline(user: &User) {
        assert!(!user.is_online, "User should be offline");
    }

    /// 断言用户列表包含特定用户
    pub fn assert_contains_user(users: &[User], user_id: &str) {
        assert!(
            users.iter().any(|u| u.id == user_id),
            "User list should contain user with ID: {}",
            user_id
        );
    }

    /// 断言用户列表不包含特定用户
    pub fn assert_not_contains_user(users: &[User], user_id: &str) {
        assert!(
            !users.iter().any(|u| u.id == user_id),
            "User list should not contain user with ID: {}",
            user_id
        );
    }
}

// ============================================================================
// 性能测量工具
// ============================================================================

pub mod perf {
    use std::time::{Duration, Instant};

    /// 测量函数执行时间
    pub fn measure<F, R>(f: F) -> (R, Duration)
    where
        F: FnOnce() -> R,
    {
        let start = Instant::now();
        let result = f();
        let duration = start.elapsed();
        (result, duration)
    }

    /// 测量并打印执行时间
    pub fn measure_and_print<F, R>(name: &str, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let (result, duration) = measure(f);
        println!("[PERF] {} took {:?}", name, duration);
        result
    }

    /// 断言操作在指定时间内完成
    pub fn assert_completes_within<F, R>(max_duration: Duration, f: F) -> R
    where
        F: FnOnce() -> R,
    {
        let (result, duration) = measure(f);
        assert!(
            duration <= max_duration,
            "Operation took {:?}, expected <= {:?}",
            duration,
            max_duration
        );
        result
    }

    /// 批量性能测试
    pub fn benchmark<F>(name: &str, iterations: usize, mut f: F)
    where
        F: FnMut(),
    {
        let mut total = Duration::ZERO;
        let mut min = Duration::MAX;
        let mut max = Duration::ZERO;

        for _ in 0..iterations {
            let (_, duration) = measure(&mut f);
            total += duration;
            min = min.min(duration);
            max = max.max(duration);
        }

        let avg = total / iterations as u32;
        println!("[BENCHMARK] {}", name);
        println!("  Iterations: {}", iterations);
        println!("  Average: {:?}", avg);
        println!("  Min: {:?}", min);
        println!("  Max: {:?}", max);
        println!("  Total: {:?}", total);
    }
}

// ============================================================================
// 测试清理工具
// ============================================================================

pub mod cleanup {
    use std::fs;
    use std::path::Path;

    /// 清理测试文件
    pub fn cleanup_test_files(dir: &str) {
        if Path::new(dir).exists() {
            let _ = fs::remove_dir_all(dir);
        }
    }

    /// 创建临时测试目录
    pub fn create_test_dir() -> String {
        let path = format!("/tmp/test_{}", uuid::Uuid::new_v4());
        fs::create_dir_all(&path).unwrap();
        path
    }

    /// RAII 风格的临时目录清理
    pub struct TempDir {
        path: String,
    }

    impl TempDir {
        pub fn new() -> Self {
            let path = format!("/tmp/test_{}", uuid::Uuid::new_v4());
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        pub fn path(&self) -> &str {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

// ============================================================================
// 并发测试工具
// ============================================================================

pub mod concurrent {
    use std::sync::{Arc, Mutex};
    use std::thread;

    /// 并发执行多个操作
    pub fn run_concurrent<F, R>(count: usize, f: F) -> Vec<R>
    where
        F: Fn(usize) -> R + Send + Sync + 'static,
        R: Send + 'static,
    {
        let f = Arc::new(f);
        let mut handles = vec![];

        for i in 0..count {
            let f_clone = Arc::clone(&f);
            let handle = thread::spawn(move || f_clone(i));
            handles.push(handle);
        }

        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    }

    /// 计数成功的并发操作
    pub fn count_successes<F>(count: usize, f: F) -> usize
    where
        F: Fn(usize) -> bool + Send + Sync + 'static,
    {
        run_concurrent(count, f)
            .into_iter()
            .filter(|&success| success)
            .count()
    }

    /// 共享状态的并发测试
    pub fn test_shared_state<T, F, R>(initial: T, count: usize, f: F) -> Vec<R>
    where
        T: Send + 'static,
        F: Fn(Arc<Mutex<T>>, usize) -> R + Send + Sync + 'static,
        R: Send + 'static,
    {
        let state = Arc::new(Mutex::new(initial));
        let f = Arc::new(f);
        let mut handles = vec![];

        for i in 0..count {
            let state_clone = Arc::clone(&state);
            let f_clone = Arc::clone(&f);
            let handle = thread::spawn(move || f_clone(state_clone, i));
            handles.push(handle);
        }

        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    }
}

// ============================================================================
// 随机数据生成
// ============================================================================

pub mod random {
    use rand::Rng;

    /// 生成随机字符串
    pub fn random_string(len: usize) -> String {
        rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(len)
            .map(char::from)
            .collect()
    }

    /// 生成随机用户名
    pub fn random_username() -> String {
        format!("user_{}", random_string(8))
    }

    /// 生成随机房间 key
    pub fn random_room_key() -> String {
        format!("room_{}", random_string(10))
    }

    /// 生成随机文件名
    pub fn random_filename(ext: &str) -> String {
        format!("file_{}.{}", random_string(12), ext)
    }

    /// 生成随机 IP 地址
    pub fn random_ip() -> String {
        let mut rng = rand::thread_rng();
        format!(
            "{}.{}.{}.{}",
            rng.gen_range(1..255),
            rng.gen_range(0..255),
            rng.gen_range(0..255),
            rng.gen_range(1..255)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_factory_create_user() {
        let user = TestDataFactory::create_user("user1", "TestUser", "room1");
        assert_eq!(user.id, "user1");
        assert_eq!(user.username, "TestUser");
        assert_eq!(user.room_key, "room1");
    }

    #[test]
    fn test_factory_create_message() {
        let user = TestDataFactory::create_user("user1", "TestUser", "room1");
        let message = TestDataFactory::create_message(&user, "room1", "Hello");

        assert_eq!(message.message_type, MessageType::Text);
        assert_eq!(message.content, Some("Hello".to_string()));
        assert_eq!(message.sender.id, "user1");
    }

    #[test]
    fn test_perf_measure() {
        let (result, duration) = perf::measure(|| {
            std::thread::sleep(std::time::Duration::from_millis(10));
            42
        });

        assert_eq!(result, 42);
        assert!(duration.as_millis() >= 10);
    }

    #[test]
    fn test_concurrent_run() {
        let results = concurrent::run_concurrent(10, |i| i * 2);
        assert_eq!(results.len(), 10);
        assert_eq!(results[5], 10);
    }

    #[test]
    fn test_random_string() {
        let s1 = random::random_string(10);
        let s2 = random::random_string(10);

        assert_eq!(s1.len(), 10);
        assert_eq!(s2.len(), 10);
        assert_ne!(s1, s2); // 极小概率相同
    }
}
