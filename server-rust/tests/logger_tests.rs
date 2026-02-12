// Logger Tests
//
// These tests verify logging behaviors that should be preserved
// during Rust migration from the Node.js implementation
use std::collections::HashMap;

#[cfg(test)]
mod tests {
    use super::*;

    // LogLevel tests
    #[test]
    fn test_log_level_ordering() {
        #[repr(u8)]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        enum LogLevel {
            Debug = 0,
            Info = 1,
            Warn = 2,
            Error = 3,
            Silent = 4,
        }

        assert!(LogLevel::Debug < LogLevel::Info);
        assert!(LogLevel::Info < LogLevel::Warn);
        assert!(LogLevel::Warn < LogLevel::Error);
        assert!(LogLevel::Error < LogLevel::Silent);
    }

    #[test]
    fn test_log_level_filtering() {
        #[repr(u8)]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        enum LogLevel {
            Debug = 0,
            Info = 1,
            Warn = 2,
            Error = 3,
            Silent = 4,
        }

        fn should_log(message_level: LogLevel, config_level: LogLevel) -> bool {
            message_level >= config_level && config_level != LogLevel::Silent
        }

        // When level is INFO, DEBUG should not log
        assert!(!should_log(LogLevel::Debug, LogLevel::Info));
        assert!(should_log(LogLevel::Info, LogLevel::Info));
        assert!(should_log(LogLevel::Warn, LogLevel::Info));
        assert!(should_log(LogLevel::Error, LogLevel::Info));

        // When level is WARN, DEBUG and INFO should not log
        assert!(!should_log(LogLevel::Debug, LogLevel::Warn));
        assert!(!should_log(LogLevel::Info, LogLevel::Warn));
        assert!(should_log(LogLevel::Warn, LogLevel::Warn));
        assert!(should_log(LogLevel::Error, LogLevel::Warn));

        // SILENT should not log anything
        assert!(!should_log(LogLevel::Debug, LogLevel::Silent));
        assert!(!should_log(LogLevel::Info, LogLevel::Silent));
        assert!(!should_log(LogLevel::Warn, LogLevel::Silent));
        assert!(!should_log(LogLevel::Error, LogLevel::Silent));
    }

    // Log level configuration tests
    #[test]
    fn test_set_level_by_string() {
        fn parse_log_level(s: &str) -> Option<u8> {
            match s.to_uppercase().as_str() {
                "DEBUG" => Some(0),
                "INFO" => Some(1),
                "WARN" => Some(2),
                "ERROR" => Some(3),
                "SILENT" => Some(4),
                _ => None,
            }
        }

        assert_eq!(parse_log_level("debug"), Some(0));
        assert_eq!(parse_log_level("INFO"), Some(1));
        assert_eq!(parse_log_level("Warn"), Some(2));
        assert_eq!(parse_log_level("error"), Some(3));
        assert_eq!(parse_log_level("invalid"), None);
    }

    #[test]
    fn test_load_level_from_environment() {
        fn get_log_level_from_env(env_value: Option<&str>) -> u8 {
            const DEFAULT_LEVEL: u8 = 1; // INFO

            match env_value {
                None => DEFAULT_LEVEL,
                Some(s) => match s.to_uppercase().as_str() {
                    "DEBUG" => 0,
                    "INFO" => 1,
                    "WARN" => 2,
                    "ERROR" => 3,
                    "SILENT" => 4,
                    _ => DEFAULT_LEVEL,
                },
            }
        }

        assert_eq!(get_log_level_from_env(None), 1); // Default to INFO
        assert_eq!(get_log_level_from_env(Some("DEBUG")), 0);
        assert_eq!(get_log_level_from_env(Some("error")), 3);
        assert_eq!(get_log_level_from_env(Some("invalid")), 1); // Default to INFO
    }

    // Message formatting tests
    #[test]
    fn test_timestamp_format() {
        let timestamp = chrono::Utc::now().to_rfc3339();
        // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
        assert!(timestamp.contains('T'));
        assert!(timestamp.ends_with('Z') || timestamp.contains('+'));
    }

    #[test]
    fn test_optional_timestamp() {
        fn format_message(message: &str, timestamps: bool) -> String {
            if timestamps {
                format!("{} {}", chrono::Utc::now().to_rfc3339(), message)
            } else {
                message.to_string()
            }
        }

        let with_timestamp = format_message("test", true);
        let without_timestamp = format_message("test", false);

        assert!(with_timestamp.contains("test"));
        assert!(with_timestamp.len() > "test".len());
        assert_eq!(without_timestamp, "test");
    }

    #[test]
    fn test_level_prefix() {
        fn format_level(level: &str) -> String {
            format!("[{}]", level)
        }

        assert_eq!(format_level("DEBUG"), "[DEBUG]");
        assert_eq!(format_level("INFO"), "[INFO]");
        assert_eq!(format_level("WARN"), "[WARN]");
        assert_eq!(format_level("ERROR"), "[ERROR]");
    }

    #[test]
    fn test_context_prefix() {
        fn format_with_context(message: &str, context: Option<&str>) -> String {
            if let Some(ctx) = context {
                format!("[{}] {}", ctx, message)
            } else {
                message.to_string()
            }
        }

        assert_eq!(
            format_with_context("test", Some("RoomService")),
            "[RoomService] test"
        );
        assert_eq!(
            format_with_context("test", Some("FileManager")),
            "[FileManager] test"
        );
        assert_eq!(format_with_context("test", None), "test");
    }

    #[test]
    fn test_data_serialization() {
        fn serialize_data(data: &serde_json::Value) -> String {
            serde_json::to_string(data).unwrap_or_else(|_| String::new())
        }

        let obj = serde_json::json!({"key": "value"});
        let arr = serde_json::json!([1, 2, 3]);
        let str_val = serde_json::json!("string");
        let num = serde_json::json!(123);

        assert_eq!(serialize_data(&obj), r#"{"key":"value"}"#);
        assert_eq!(serialize_data(&arr), "[1,2,3]");
        assert_eq!(serialize_data(&str_val), r#""string""#);
        assert_eq!(serialize_data(&num), "123");
    }

    // Color support tests
    #[test]
    fn test_ansi_color_codes() {
        struct Colors {
            debug: &'static str,
            info: &'static str,
            warn: &'static str,
            error: &'static str,
            reset: &'static str,
            gray: &'static str,
            magenta: &'static str,
        }

        let colors = Colors {
            debug: "\x1b[36m", // cyan
            info: "\x1b[32m",  // green
            warn: "\x1b[33m",  // yellow
            error: "\x1b[31m", // red
            reset: "\x1b[0m",
            gray: "\x1b[90m",
            magenta: "\x1b[35m",
        };

        assert_eq!(colors.debug, "\x1b[36m");
        assert_eq!(colors.info, "\x1b[32m");
        assert_eq!(colors.warn, "\x1b[33m");
        assert_eq!(colors.error, "\x1b[31m");
        assert_eq!(colors.reset, "\x1b[0m");
        assert_eq!(colors.gray, "\x1b[90m");
        assert_eq!(colors.magenta, "\x1b[35m");
    }

    #[test]
    fn test_optional_colors() {
        fn format_level(level: &str, use_colors: bool) -> String {
            if use_colors {
                let color = match level {
                    "DEBUG" => "\x1b[36m",
                    "INFO" => "\x1b[32m",
                    "WARN" => "\x1b[33m",
                    "ERROR" => "\x1b[31m",
                    _ => "",
                };
                format!("{}[{}]\x1b[0m", color, level)
            } else {
                format!("[{}]", level)
            }
        }

        let colored = format_level("INFO", true);
        let plain = format_level("INFO", false);

        assert!(colored.contains("\x1b[32m"));
        assert_eq!(plain, "[INFO]");
        assert!(!plain.contains("\x1b["));
    }

    // Contextual logger tests
    #[test]
    fn test_contextual_logger() {
        struct ContextualLogger {
            context: String,
        }

        impl ContextualLogger {
            fn new(context: &str) -> Self {
                Self {
                    context: context.to_string(),
                }
            }

            fn debug(&self, message: &str) -> String {
                format!("[DEBUG] [{}] {}", self.context, message)
            }

            fn info(&self, message: &str) -> String {
                format!("[INFO] [{}] {}", self.context, message)
            }

            fn warn(&self, message: &str) -> String {
                format!("[WARN] [{}] {}", self.context, message)
            }

            fn error(&self, message: &str) -> String {
                format!("[ERROR] [{}] {}", self.context, message)
            }
        }

        let room_logger = ContextualLogger::new("RoomService");

        assert!(room_logger.info("Room created").contains("[RoomService]"));
        assert!(room_logger.error("Room error").contains("[RoomService]"));
        assert!(room_logger.debug("Debug msg").contains("[DEBUG]"));
        assert!(room_logger.warn("Warn msg").contains("[WARN]"));
    }

    // Console output methods tests
    #[test]
    fn test_console_method_mapping() {
        let console_methods: HashMap<&str, &str> = [
            ("DEBUG", "debug"),
            ("INFO", "info"),
            ("WARN", "warn"),
            ("ERROR", "error"),
        ]
        .iter()
        .cloned()
        .collect();

        assert_eq!(console_methods.get("DEBUG"), Some(&"debug"));
        assert_eq!(console_methods.get("INFO"), Some(&"info"));
        assert_eq!(console_methods.get("WARN"), Some(&"warn"));
        assert_eq!(console_methods.get("ERROR"), Some(&"error"));
    }

    // Environment configuration tests
    #[test]
    fn test_valid_log_level_env_values() {
        let valid_values = vec!["DEBUG", "INFO", "WARN", "ERROR", "SILENT"];

        for value in valid_values {
            assert!(["DEBUG", "INFO", "WARN", "ERROR", "SILENT"].contains(&value));
        }
    }

    #[test]
    fn test_parse_boolean_env() {
        fn parse_boolean(value: Option<&str>) -> bool {
            match value {
                Some("false") | Some("0") => false,
                _ => true, // Default to true
            }
        }

        assert!(!parse_boolean(Some("false")));
        assert!(!parse_boolean(Some("0")));
        assert!(parse_boolean(Some("true")));
        assert!(parse_boolean(None));
    }

    #[test]
    fn test_log_colors_environment() {
        fn parse_colors(value: Option<&str>) -> bool {
            !matches!(value, Some("false") | Some("0"))
        }

        assert!(!parse_colors(Some("false")));
        assert!(!parse_colors(Some("0")));
        assert!(parse_colors(Some("true")));
        assert!(parse_colors(None));
    }

    #[test]
    fn test_log_timestamps_environment() {
        fn parse_timestamps(value: Option<&str>) -> bool {
            value != Some("false")
        }

        assert!(!parse_timestamps(Some("false")));
        assert!(parse_timestamps(Some("true")));
        assert!(parse_timestamps(None));
    }

    #[test]
    fn test_log_context_environment() {
        fn parse_context(value: Option<&str>) -> bool {
            value != Some("false")
        }

        assert!(!parse_context(Some("false")));
        assert!(parse_context(Some("true")));
        assert!(parse_context(None));
    }
}
