use cloud_clipboard_server::AppState;
use cloud_clipboard_server::services::traits::*;
use std::sync::Arc;

#[allow(dead_code)]
pub fn create_test_app_state(
    room_service: Arc<dyn RoomServiceTrait>,
    file_manager: Arc<dyn FileManagerTrait>,
    share_service: Arc<dyn ShareServiceTrait>,
) -> AppState {
    AppState::new(room_service, file_manager, share_service)
}
