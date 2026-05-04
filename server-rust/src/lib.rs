// Library entry point for testing
pub mod config;
pub mod error;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod services;
pub mod utils;

use crate::services::traits::{FileManagerTrait, RoomServiceTrait, ShareServiceTrait};
use std::sync::Arc;
use std::time::Instant;

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    pub room_service: Arc<dyn RoomServiceTrait>,
    pub file_manager: Arc<dyn FileManagerTrait>,
    pub share_service: Arc<dyn ShareServiceTrait>,
    pub start_time: Instant,
}

impl AppState {
    pub fn new(
        room_service: Arc<dyn RoomServiceTrait>,
        file_manager: Arc<dyn FileManagerTrait>,
        share_service: Arc<dyn ShareServiceTrait>,
    ) -> Self {
        Self {
            room_service,
            file_manager,
            share_service,
            start_time: Instant::now(),
        }
    }
}
