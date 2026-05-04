use async_trait::async_trait;
use cloud_clipboard_server::services::file_manager::{FileInfo, FileStats, StorageUsage};
use cloud_clipboard_server::services::traits::FileManagerTrait;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct MockFileManager {
    upload_dir_path: PathBuf,
    files: Mutex<std::collections::HashMap<String, FileInfo>>,
    max_file_size_val: u64,
}

impl MockFileManager {
    pub fn new() -> Self {
        Self {
            upload_dir_path: std::env::temp_dir().join("cloud-clipboard-test-uploads"),
            files: Mutex::new(std::collections::HashMap::new()),
            max_file_size_val: 100 * 1024 * 1024, // 100MB
        }
    }

    pub fn add_file(&self, filename: &str, info: FileInfo) {
        self.files
            .lock()
            .unwrap()
            .insert(filename.to_string(), info);
    }

    pub fn set_max_file_size(&mut self, size: u64) {
        self.max_file_size_val = size;
    }
}

#[async_trait]
impl FileManagerTrait for MockFileManager {
    async fn save_file(
        &self,
        _room_key: &str,
        _original_name: &str,
        _mime_type: &str,
        _data: &[u8],
    ) -> anyhow::Result<FileInfo> {
        Err(anyhow::anyhow!("Not implemented"))
    }

    fn get_file(&self, filename: &str) -> Option<FileInfo> {
        self.files.lock().unwrap().get(filename).cloned()
    }

    fn get_file_path(&self, filename: &str) -> Option<PathBuf> {
        Some(self.upload_dir_path.join(filename))
    }

    async fn delete_file(&self, _filename: &str) -> anyhow::Result<Option<FileInfo>> {
        Ok(None)
    }

    fn delete_room_files(&self, _room_key: &str) -> Vec<FileInfo> {
        vec![]
    }

    async fn cleanup_expired_files(&self) -> Vec<FileInfo> {
        vec![]
    }

    async fn cleanup_orphaned_files(&self) -> usize {
        0
    }

    fn get_stats(&self) -> FileStats {
        FileStats {
            total_files: 0,
            total_size: 0,
            room_count: 0,
            deleted_files: 0,
            deleted_size: 0,
        }
    }

    fn get_storage_usage(&self) -> StorageUsage {
        StorageUsage {
            used: 0,
            limit: self.max_file_size_val,
        }
    }

    fn upload_dir(&self) -> PathBuf {
        self.upload_dir_path.clone()
    }

    fn max_file_size(&self) -> u64 {
        self.max_file_size_val
    }

    fn get_retention_hours(&self) -> i64 {
        12
    }
}
