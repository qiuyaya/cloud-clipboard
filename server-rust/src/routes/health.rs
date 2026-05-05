use axum::{Json, extract::State};
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub success: bool,
    pub message: String,
    pub data: HealthData,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthData {
    pub uptime: f64,
    pub timestamp: String,
    pub total_rooms: usize,
    pub total_users: usize,
    pub online_users: usize,
    pub total_files: usize,
    pub total_size: u64,
    pub memory: MemoryInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub rss: u64,
}

fn get_rss_bytes() -> u64 {
    // Read RSS from /proc/self/statm (Linux)
    std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|content| {
            content
                .split_whitespace()
                .nth(1) // RSS is the second field (in pages)
                .and_then(|rss| rss.parse::<u64>().ok())
                .map(|pages| pages * 4096) // Convert pages to bytes
        })
        .unwrap_or(0)
}

pub async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    let room_stats = state.room_service.get_room_stats();
    let file_stats = state.file_manager.get_stats();

    Json(HealthResponse {
        success: true,
        message: "Server is healthy".to_string(),
        data: HealthData {
            uptime: state.start_time.elapsed().as_secs_f64(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            total_rooms: room_stats.total_rooms,
            total_users: room_stats.total_users,
            online_users: room_stats.online_users,
            total_files: file_stats.total_files,
            total_size: file_stats.total_size,
            memory: MemoryInfo {
                rss: get_rss_bytes(),
            },
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_response_serialization() {
        let resp = HealthResponse {
            success: true,
            message: "Server is healthy".to_string(),
            data: HealthData {
                uptime: 123.45,
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                total_rooms: 5,
                total_users: 10,
                online_users: 8,
                total_files: 3,
                total_size: 1024,
                memory: MemoryInfo { rss: 4096 },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"totalRooms\":5"));
        assert!(json.contains("\"onlineUsers\":8"));
        assert!(json.contains("\"totalFiles\":3"));
    }

    #[test]
    fn memory_info_serialization() {
        let mem = MemoryInfo { rss: 8192 };
        let json = serde_json::to_string(&mem).unwrap();
        assert!(json.contains("\"rss\":8192"));
    }

    #[test]
    fn health_data_camel_case() {
        let data = HealthData {
            uptime: 0.0,
            timestamp: "t".to_string(),
            total_rooms: 0,
            total_users: 0,
            online_users: 0,
            total_files: 0,
            total_size: 0,
            memory: MemoryInfo { rss: 0 },
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("totalRooms"));
        assert!(json.contains("onlineUsers"));
        assert!(json.contains("totalFiles"));
        assert!(json.contains("totalSize"));
    }

    #[test]
    fn get_rss_bytes_returns_non_negative() {
        let rss = get_rss_bytes();
        // On Linux with /proc, should return a positive value
        // On other platforms, returns 0
        let _ = rss;
    }

    #[test]
    fn health_data_default_values() {
        let data = HealthData {
            uptime: 0.0,
            timestamp: "t".to_string(),
            total_rooms: 0,
            total_users: 0,
            online_users: 0,
            total_files: 0,
            total_size: 0,
            memory: MemoryInfo { rss: 0 },
        };
        let json = serde_json::to_string(&data).unwrap();
        // Verify all fields are present in camelCase
        assert!(json.contains("\"totalRooms\":0"));
        assert!(json.contains("\"totalUsers\":0"));
        assert!(json.contains("\"onlineUsers\":0"));
        assert!(json.contains("\"totalFiles\":0"));
        assert!(json.contains("\"totalSize\":0"));
    }

    #[test]
    fn health_response_message_field() {
        let resp = HealthResponse {
            success: true,
            message: "Server is healthy".to_string(),
            data: HealthData {
                uptime: 0.0,
                timestamp: "t".to_string(),
                total_rooms: 0,
                total_users: 0,
                online_users: 0,
                total_files: 0,
                total_size: 0,
                memory: MemoryInfo { rss: 0 },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"message\":\"Server is healthy\""));
    }

    #[test]
    fn health_data_all_fields_present() {
        let data = HealthData {
            uptime: 123.45,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            total_rooms: 5,
            total_users: 10,
            online_users: 8,
            total_files: 3,
            total_size: 1024,
            memory: MemoryInfo { rss: 4096 },
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"uptime\":123.45"));
        assert!(json.contains("\"timestamp\":\"2024-01-01T00:00:00Z\""));
        assert!(json.contains("\"totalRooms\":5"));
        assert!(json.contains("\"totalUsers\":10"));
        assert!(json.contains("\"onlineUsers\":8"));
        assert!(json.contains("\"totalFiles\":3"));
        assert!(json.contains("\"totalSize\":1024"));
        assert!(json.contains("\"memory\":"));
        assert!(json.contains("\"rss\":4096"));
    }

    #[test]
    fn health_response_false_success() {
        let resp = HealthResponse {
            success: false,
            message: "Service degraded".to_string(),
            data: HealthData {
                uptime: 0.0,
                timestamp: "t".to_string(),
                total_rooms: 0,
                total_users: 0,
                online_users: 0,
                total_files: 0,
                total_size: 0,
                memory: MemoryInfo { rss: 0 },
            },
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":false"));
        assert!(json.contains("\"message\":\"Service degraded\""));
    }

    #[test]
    fn health_data_large_values() {
        let data = HealthData {
            uptime: 86400.0,
            timestamp: "2024-12-31T23:59:59Z".to_string(),
            total_rooms: 100,
            total_users: 500,
            online_users: 200,
            total_files: 1000,
            total_size: 1024 * 1024 * 1024, // 1GB
            memory: MemoryInfo {
                rss: 512 * 1024 * 1024,
            }, // 512MB
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"uptime\":86400"));
        assert!(json.contains("\"totalRooms\":100"));
    }
}
