use axum::{
    extract::State,
    Json,
};
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
            content.split_whitespace()
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
            uptime: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs_f64(),
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
