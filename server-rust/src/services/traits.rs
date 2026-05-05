use crate::models::*;
use crate::services::file_manager::{FileInfo, FileStats, StorageUsage};
use crate::services::room_service::{JoinRoomRequest, RoomEvent, RoomStats};
use crate::services::share_service::CreateShareRequest;
use async_trait::async_trait;
use std::path::PathBuf;
use tokio::sync::broadcast;

// RoomServiceTrait: 全部方法为同步，不需要 #[async_trait]
pub trait RoomServiceTrait: Send + Sync {
    fn create_room(
        &self,
        room_key: &str,
        password: Option<&str>,
        creator_fingerprint: Option<&str>,
    ) -> Result<RoomInfo, String>;
    fn get_room_info(&self, room_key: &str) -> Option<RoomInfo>;
    fn room_exists(&self, room_key: &str) -> bool;
    fn room_has_password(&self, room_key: &str) -> bool;
    fn get_room_password(&self, room_key: &str) -> Option<String>;
    fn verify_room_password(&self, room_key: &str, password: &str) -> Result<bool, String>;
    fn join_room(&self, req: JoinRoomRequest) -> Result<(User, Vec<User>), String>;
    fn get_room_users(&self, room_key: &str) -> Vec<User>;
    fn get_messages(&self, room_key: &str) -> Vec<Message>;
    fn find_user_by_fingerprint(&self, room_key: &str, fingerprint_hash: &str) -> Option<User>;
    fn get_room_stats(&self) -> RoomStats;
    fn add_message(&self, room_key: &str, message: Message) -> Result<(), String>;
    fn remove_message(&self, room_key: &str, message_id: &str) -> Result<bool, String>;
    fn get_message_sender(&self, room_key: &str, message_id: &str) -> Option<String>;
    fn get_user_by_socket(&self, socket_id: &str) -> Option<User>;
    fn get_socket_by_user(&self, user_id: &str) -> Option<String>;
    fn set_room_password(&self, room_key: &str, password: Option<&str>) -> Result<bool, String>;
    fn pin_room(&self, room_key: &str, fingerprint: &str) -> Result<bool, String>;
    fn unpin_room(&self, room_key: &str, fingerprint: &str) -> Result<bool, String>;
    fn is_room_pinned(&self, room_key: &str) -> bool;
    fn update_user_status(&self, room_key: &str, user_id: &str, is_online: bool);
    fn leave_room(&self, socket_id: &str) -> Option<(String, User)>;
    fn set_user_offline(&self, socket_id: &str) -> Option<(String, User)>;
    fn subscribe(&self) -> broadcast::Receiver<RoomEvent>;
    fn cleanup_inactive_rooms(&self) -> Vec<String>;
}

// FileManagerTrait: 包含 async 方法，需要 #[async_trait]
#[async_trait]
pub trait FileManagerTrait: Send + Sync {
    async fn save_file(
        &self,
        room_key: &str,
        original_name: &str,
        mime_type: &str,
        data: &[u8],
    ) -> anyhow::Result<FileInfo>;
    fn get_file(&self, filename: &str) -> Option<FileInfo>;
    fn get_file_path(&self, filename: &str) -> Option<PathBuf>;
    async fn delete_file(&self, filename: &str) -> anyhow::Result<Option<FileInfo>>;
    fn delete_room_files(&self, room_key: &str) -> Vec<FileInfo>;
    async fn cleanup_expired_files(&self) -> Vec<FileInfo>;
    async fn cleanup_orphaned_files(&self) -> usize;
    fn get_stats(&self) -> FileStats;
    fn get_storage_usage(&self) -> StorageUsage;
    fn upload_dir(&self) -> PathBuf;
    fn max_file_size(&self) -> u64;
    fn get_retention_hours(&self) -> i64;
}

// ShareServiceTrait: 全部方法为同步，不需要 #[async_trait]
pub trait ShareServiceTrait: Send + Sync {
    fn create_share(&self, req: CreateShareRequest) -> Result<(ShareInfo, Option<String>), String>;
    fn get_share(&self, share_id: &str) -> Option<ShareInfo>;
    fn get_share_info(&self, share_id: &str) -> Option<ShareInfoResponse>;
    fn get_user_shares(&self, user_id: &str) -> Vec<ShareInfo>;
    fn get_user_shares_response(&self, user_id: &str) -> Vec<ShareInfoResponse>;
    fn verify_password(&self, share_id: &str, password: &str) -> Result<bool, String>;
    fn record_access(
        &self,
        share_id: &str,
        ip_address: String,
        success: bool,
        bytes: Option<u64>,
        error: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), String>;
    fn get_access_logs(&self, share_id: &str) -> Vec<ShareAccessLog>;
    fn revoke_share(&self, share_id: &str) -> Result<bool, String>;
    fn delete_share(&self, share_id: &str) -> Result<Option<ShareInfo>, String>;
    fn cleanup_expired_shares(&self) -> Vec<ShareInfo>;
}
