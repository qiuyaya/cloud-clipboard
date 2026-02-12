// Library entry point for testing
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;
pub mod utils;

use crate::services::{FileManager, RoomService, ShareService};
use std::sync::Arc;

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<RoomService>,
    pub file_manager: Arc<FileManager>,
    pub share_service: Arc<ShareService>,
    pub start_time: std::time::Instant,
}
