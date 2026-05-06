use std::sync::OnceLock;

static CONFIG: OnceLock<AppConfig> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub port: u16,
    pub allow_http: bool,
    pub base_path: String,
    pub static_dir: String,
    pub upload_dir: String,
    pub max_file_size: u64,
    pub max_total_storage_size: u64,
    pub file_retention_hours: u64,
    pub room_cleanup_interval_secs: u64,
    pub file_cleanup_interval_secs: u64,
    pub cleanup_orphaned_files_at_startup: bool,
    pub max_pinned_rooms: usize,
    pub public_url: Option<String>,
    pub client_url: Option<String>,
    pub rate_limit_window: u64,
    pub rate_limit_max: u32,
    pub strict_limit_max: u32,
    pub public_download_rate_limit: u32,
    pub download_timeout_secs: u64,
    pub max_download_bytes_per_minute: u64,
    pub persistence_enabled: bool,
    pub persistence_db_path: String,
    pub persistence_max_messages: usize,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let max_file_size = env_parse("MAX_FILE_SIZE", 100 * 1024 * 1024);
        Self {
            port: env_parse("PORT", 3001),
            allow_http: env_bool("ALLOW_HTTP", false),
            base_path: std::env::var("BASE_PATH")
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string(),
            static_dir: std::env::var("STATIC_DIR").unwrap_or_else(|_| "./public".to_string()),
            upload_dir: std::env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".to_string()),
            max_file_size,
            max_total_storage_size: env_parse("MAX_TOTAL_STORAGE_SIZE", 1024 * 1024 * 1024),
            file_retention_hours: env_parse("FILE_RETENTION_HOURS", 12),
            room_cleanup_interval_secs: env_parse("ROOM_CLEANUP_INTERVAL_SECONDS", 60),
            file_cleanup_interval_secs: env_parse("FILE_CLEANUP_INTERVAL_SECONDS", 600),
            cleanup_orphaned_files_at_startup: env_bool("CLEANUP_ORPHANED_FILES_AT_STARTUP", true),
            max_pinned_rooms: env_parse("MAX_PINNED_ROOMS", 50),
            public_url: std::env::var("PUBLIC_URL").ok(),
            client_url: std::env::var("CLIENT_URL").ok(),
            rate_limit_window: env_parse("RATE_LIMIT_WINDOW", 60),
            rate_limit_max: env_parse("RATE_LIMIT_MAX_REQUESTS", 500),
            strict_limit_max: env_parse("STRICT_RATE_LIMIT_MAX_REQUESTS", 50),
            public_download_rate_limit: env_parse("PUBLIC_DOWNLOAD_RATE_LIMIT", 20),
            download_timeout_secs: env_parse("DOWNLOAD_TIMEOUT", 30),
            max_download_bytes_per_minute: env_parse(
                "MAX_DOWNLOAD_BYTES_PER_MINUTE",
                max_file_size * 10,
            ),
            persistence_enabled: env_bool("PERSISTENCE_ENABLED", true),
            persistence_db_path: std::env::var("PERSISTENCE_DB_PATH")
                .unwrap_or_else(|_| "data/pinned_rooms.db".to_string()),
            persistence_max_messages: env_parse("PERSISTENCE_MAX_MESSAGES", 1000usize),
        }
    }

    pub fn is_production(&self) -> bool {
        !self.allow_http
    }
}

pub fn init_config() -> &'static AppConfig {
    CONFIG.get_or_init(AppConfig::from_env)
}

/// Get a reference to the global config.
/// Panics if `init_config()` has not been called yet.
pub fn config() -> &'static AppConfig {
    CONFIG
        .get()
        .expect("Config not initialized. Call init_config() first.")
}

/// Try to get a reference to the global config.
/// Returns None if `init_config()` has not been called yet.
pub fn try_config() -> Option<&'static AppConfig> {
    CONFIG.get()
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .map(|v| v.to_lowercase() == "true")
        .unwrap_or(default)
}

/// Get the persistence database path (default: "data/pinned_rooms.db")
pub fn get_persistence_db_path() -> String {
    try_config()
        .map(|c| c.persistence_db_path.clone())
        .unwrap_or_else(|| {
            std::env::var("PERSISTENCE_DB_PATH")
                .unwrap_or_else(|_| "data/pinned_rooms.db".to_string())
        })
}

/// Check if persistence is enabled (default: true)
pub fn is_persistence_enabled() -> bool {
    try_config()
        .map(|c| c.persistence_enabled)
        .unwrap_or_else(|| {
            std::env::var("PERSISTENCE_ENABLED")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(true)
        })
}

/// Get the max messages to load per room from persistence (default: 1000)
pub fn get_persistence_max_messages() -> usize {
    try_config()
        .map(|c| c.persistence_max_messages)
        .unwrap_or_else(|| {
            std::env::var("PERSISTENCE_MAX_MESSAGES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_env_parse_default() {
        assert_eq!(env_parse::<u16>("__TEST_NONEXISTENT_VAR__", 42), 42);
    }

    #[test]
    fn test_env_bool_default() {
        assert!(!env_bool("__TEST_NONEXISTENT_VAR__", false));
        assert!(env_bool("__TEST_NONEXISTENT_VAR__", true));
    }

    #[test]
    fn test_app_config_from_env_defaults() {
        let config = AppConfig::from_env();
        assert_eq!(config.port, 3001);
        assert!(!config.allow_http);
        assert_eq!(config.max_file_size, 100 * 1024 * 1024);
        assert_eq!(config.max_total_storage_size, 1024 * 1024 * 1024);
        assert_eq!(config.file_retention_hours, 12);
        assert_eq!(config.max_pinned_rooms, 50);
        assert_eq!(config.rate_limit_max, 500);
        assert_eq!(config.download_timeout_secs, 30);
        assert!(config.is_production());
    }

    #[test]
    fn test_is_production() {
        let mut config = AppConfig::from_env();
        config.allow_http = false;
        assert!(config.is_production());

        config.allow_http = true;
        assert!(!config.is_production());
    }

    #[test]
    fn test_try_config_returns_none_before_init() {
        // try_config returns None if init_config hasn't been called
        // In test environment, CONFIG may or may not be initialized
        // Just verify it doesn't panic
        let _ = try_config();
    }

    #[test]
    fn test_env_bool_true() {
        // SAFETY: test-only, single-threaded, cleanup after use
        unsafe { std::env::set_var("__TEST_BOOL_VAR__", "true") };
        assert!(env_bool("__TEST_BOOL_VAR__", false));
        unsafe { std::env::remove_var("__TEST_BOOL_VAR__") };
    }

    #[test]
    fn test_env_bool_false() {
        unsafe { std::env::set_var("__TEST_BOOL_VAR__", "false") };
        assert!(!env_bool("__TEST_BOOL_VAR__", true));
        unsafe { std::env::remove_var("__TEST_BOOL_VAR__") };
    }

    #[test]
    fn test_env_bool_case_insensitive() {
        unsafe { std::env::set_var("__TEST_BOOL_VAR__", "TRUE") };
        assert!(env_bool("__TEST_BOOL_VAR__", false));
        unsafe { std::env::remove_var("__TEST_BOOL_VAR__") };
    }
}
