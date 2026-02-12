use chrono::{DateTime, Duration, Utc};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    RwLock,
    atomic::{AtomicU64, Ordering},
};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// File metadata
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub filename: String,
    pub original_name: String,
    pub size: u64,
    pub mime_type: String,
    pub room_key: String,
    pub uploaded_at: DateTime<Utc>,
    pub path: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_duplicate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_file_id: Option<String>,
}

/// File manager service
pub struct FileManager {
    upload_dir: PathBuf,
    files: RwLock<HashMap<String, FileInfo>>,
    room_files: RwLock<HashMap<String, Vec<String>>>, // room_key -> [filename]
    hash_to_file_id: RwLock<HashMap<String, String>>, // sha256_hash -> filename
    max_file_size: u64,
    retention_hours: i64,
    deleted_file_count: AtomicU64,
    total_deleted_size: AtomicU64,
}

impl FileManager {
    pub fn new() -> anyhow::Result<Self> {
        let upload_dir = std::env::var("UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./uploads"));

        let max_file_size = std::env::var("MAX_FILE_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(100 * 1024 * 1024); // 100MB default

        let retention_hours = std::env::var("FILE_RETENTION_HOURS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(12);

        Self::new_with_config(upload_dir, max_file_size, retention_hours)
    }

    pub fn new_with_config(
        upload_dir: PathBuf,
        max_file_size: u64,
        retention_hours: i64,
    ) -> anyhow::Result<Self> {
        // Create upload directory if it doesn't exist
        std::fs::create_dir_all(&upload_dir)?;

        Ok(Self {
            upload_dir,
            files: RwLock::new(HashMap::new()),
            room_files: RwLock::new(HashMap::new()),
            hash_to_file_id: RwLock::new(HashMap::new()),
            max_file_size,
            retention_hours,
            deleted_file_count: AtomicU64::new(0),
            total_deleted_size: AtomicU64::new(0),
        })
    }

    /// Get upload directory
    pub fn upload_dir(&self) -> &Path {
        &self.upload_dir
    }

    /// Get max file size
    pub fn max_file_size(&self) -> u64 {
        self.max_file_size
    }

    /// Save uploaded file with SHA-256 deduplication
    pub async fn save_file(
        &self,
        room_key: &str,
        original_name: &str,
        mime_type: &str,
        data: &[u8],
    ) -> anyhow::Result<FileInfo> {
        if data.len() as u64 > self.max_file_size {
            anyhow::bail!("File too large");
        }

        // Compute SHA-256 hash
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash_hex = format!("{:x}", hasher.finalize());

        // Unified lock order: files → hash_to_file_id
        // Check for duplicate (acquire files read lock first)
        let existing_file = {
            let files = self
                .files
                .read()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            let hash_map = self
                .hash_to_file_id
                .read()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            hash_map
                .get(&hash_hex)
                .and_then(|existing_filename| files.get(existing_filename).cloned())
        };

        if let Some(existing) = existing_file {
            // Duplicate found - reuse existing file, create new metadata entry
            let ext = Path::new(original_name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            let filename = format!(
                "{}_{}.{}",
                uuid::Uuid::new_v4(),
                Utc::now().timestamp_millis(),
                ext
            );

            let file_info = FileInfo {
                filename: filename.clone(),
                original_name: original_name.to_string(),
                size: data.len() as u64,
                mime_type: mime_type.to_string(),
                room_key: room_key.to_string(),
                uploaded_at: Utc::now(),
                path: existing.path.clone(),
                hash: Some(hash_hex),
                is_duplicate: Some(true),
                original_file_id: Some(existing.filename.clone()),
            };

            {
                let mut files = self
                    .files
                    .write()
                    .map_err(|_| anyhow::anyhow!("Lock error"))?;
                files.insert(filename.clone(), file_info.clone());
            }

            {
                let mut room_files = self
                    .room_files
                    .write()
                    .map_err(|_| anyhow::anyhow!("Lock error"))?;
                room_files
                    .entry(room_key.to_string())
                    .or_default()
                    .push(filename);
            }

            tracing::info!(
                "File deduplicated: {} (duplicate of {})",
                original_name,
                existing.filename
            );
            return Ok(file_info);
        }

        // Generate unique filename
        let ext = Path::new(original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let filename = format!(
            "{}_{}.{}",
            uuid::Uuid::new_v4(),
            Utc::now().timestamp_millis(),
            ext
        );

        let file_path = self.upload_dir.join(&filename);

        // Write file
        let mut file = fs::File::create(&file_path).await?;
        file.write_all(data).await?;
        file.flush().await?;

        let file_info = FileInfo {
            filename: filename.clone(),
            original_name: original_name.to_string(),
            size: data.len() as u64,
            mime_type: mime_type.to_string(),
            room_key: room_key.to_string(),
            uploaded_at: Utc::now(),
            path: file_path,
            hash: Some(hash_hex.clone()),
            is_duplicate: Some(false),
            original_file_id: None,
        };

        // Track file
        {
            let mut files = self
                .files
                .write()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            files.insert(filename.clone(), file_info.clone());
        }

        {
            let mut room_files = self
                .room_files
                .write()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            room_files
                .entry(room_key.to_string())
                .or_default()
                .push(filename.clone());
        }

        // Track hash
        {
            let mut hash_map = self
                .hash_to_file_id
                .write()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            hash_map.insert(hash_hex, filename);
        }

        tracing::info!("File uploaded: {} for room {}", original_name, room_key);
        Ok(file_info)
    }

    /// Get file info by filename
    pub fn get_file(&self, filename: &str) -> Option<FileInfo> {
        self.files.read().ok()?.get(filename).cloned()
    }

    /// Get file path
    pub fn get_file_path(&self, filename: &str) -> Option<PathBuf> {
        self.files
            .read()
            .ok()?
            .get(filename)
            .map(|f| f.path.clone())
    }

    /// Delete a file
    pub async fn delete_file(&self, filename: &str) -> anyhow::Result<Option<FileInfo>> {
        let file_info = {
            let mut files = self
                .files
                .write()
                .map_err(|_| anyhow::anyhow!("Lock error"))?;
            files.remove(filename)
        };

        if let Some(ref info) = file_info {
            // Remove from room tracking
            if let Ok(mut room_files) = self.room_files.write()
                && let Some(files) = room_files.get_mut(&info.room_key)
            {
                files.retain(|f| f != filename);
            }

            // Check if any other file references the same physical path
            let other_references = {
                let files = self
                    .files
                    .read()
                    .map_err(|_| anyhow::anyhow!("Lock error"))?;
                files.values().any(|f| f.path == info.path)
            };

            if !other_references {
                // No other references, safe to delete physical file
                if info.path.exists() {
                    fs::remove_file(&info.path).await?;
                }
                // Clean hash mapping
                if let Some(ref hash) = info.hash
                    && let Ok(mut hash_map) = self.hash_to_file_id.write()
                {
                    hash_map.remove(hash);
                }
            }

            tracing::info!("File deleted: {}", filename);
            self.deleted_file_count.fetch_add(1, Ordering::Relaxed);
            self.total_deleted_size
                .fetch_add(info.size, Ordering::Relaxed);
        }

        Ok(file_info)
    }

    /// Delete all files for a room
    pub fn delete_room_files(&self, room_key: &str) -> Vec<FileInfo> {
        // Unified lock order: files → room_files → hash_to_file_id
        let mut files = match self.files.write() {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let filenames = {
            let mut room_files = match self.room_files.write() {
                Ok(rf) => rf,
                Err(_) => return Vec::new(),
            };
            room_files.remove(room_key).unwrap_or_default()
        };

        let mut deleted = Vec::new();

        for filename in filenames {
            if let Some(info) = files.remove(&filename) {
                // Check if any other file references the same physical path
                let other_references = files.values().any(|f| f.path == info.path);

                if !other_references {
                    // No other references, safe to delete physical file
                    let _ = std::fs::remove_file(&info.path);
                    // Clean hash mapping
                    if let Some(ref hash) = info.hash
                        && let Ok(mut hash_map) = self.hash_to_file_id.write()
                    {
                        hash_map.remove(hash);
                    }
                }

                deleted.push(info);
            }
        }

        if !deleted.is_empty() {
            tracing::info!("Deleted {} files for room {}", deleted.len(), room_key);
        }

        deleted
    }

    /// Cleanup expired files
    pub async fn cleanup_expired_files(&self) -> Vec<FileInfo> {
        let cutoff = Utc::now() - Duration::hours(self.retention_hours);

        // Collect expired filenames first (avoid nested locking)
        let filenames: Vec<String> = {
            let files = match self.files.read() {
                Ok(f) => f,
                Err(_) => return Vec::new(),
            };
            files
                .iter()
                .filter(|(_, info)| info.uploaded_at < cutoff)
                .map(|(name, _)| name.clone())
                .collect()
        };

        // Delete files one by one (delete_file handles its own locking)
        let mut expired = Vec::new();
        for filename in filenames {
            if let Ok(Some(info)) = self.delete_file(&filename).await {
                expired.push(info);
            }
        }

        if !expired.is_empty() {
            tracing::info!("Cleaned up {} expired files", expired.len());
        }

        expired
    }

    /// Get statistics
    pub fn get_stats(&self) -> FileStats {
        let files = self.files.read().unwrap_or_else(|e| e.into_inner());
        let total_size: u64 = files.values().map(|f| f.size).sum();
        let room_count = {
            let rooms: std::collections::HashSet<&str> =
                files.values().map(|f| f.room_key.as_str()).collect();
            rooms.len()
        };

        FileStats {
            total_files: files.len(),
            total_size,
            room_count,
            deleted_files: self.deleted_file_count.load(Ordering::Relaxed),
            deleted_size: self.total_deleted_size.load(Ordering::Relaxed),
        }
    }

    /// Cleanup orphaned files (files in upload directory not tracked in memory)
    /// Called at startup to clean up any files from previous sessions
    pub async fn cleanup_orphaned_files(&self) -> usize {
        let mut cleaned = 0;

        if let Ok(entries) = std::fs::read_dir(&self.upload_dir) {
            let tracked_files: std::collections::HashSet<String> = {
                let files = match self.files.read() {
                    Ok(f) => f,
                    Err(_) => return 0,
                };
                files.keys().cloned().collect()
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file()
                    && let Some(filename) = path.file_name().and_then(|n| n.to_str())
                {
                    // Check if file is tracked
                    if !tracked_files.contains(filename) {
                        // File is orphaned, delete it
                        if let Ok(()) = std::fs::remove_file(&path) {
                            tracing::warn!("Cleaned up orphaned file: {}", filename);
                            cleaned += 1;
                        }
                    }
                }
            }
        }

        if cleaned > 0 {
            tracing::info!("Startup cleanup: removed {} orphaned files", cleaned);
        }

        cleaned
    }

    /// Get upload directory path for external use
    pub fn get_upload_dir_path(&self) -> &Path {
        &self.upload_dir
    }

    /// Get retention hours for external use
    pub fn get_retention_hours(&self) -> i64 {
        self.retention_hours
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStats {
    pub total_files: usize,
    pub total_size: u64,
    pub room_count: usize,
    pub deleted_files: u64,
    pub deleted_size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    // Helper to create test directory
    async fn setup_test_manager() -> (FileManager, TempDir) {
        let tmp_dir = TempDir::new().unwrap();
        let manager =
            FileManager::new_with_config(tmp_dir.path().to_path_buf(), 100 * 1024 * 1024, 12)
                .unwrap();
        (manager, tmp_dir)
    }

    // Constructor tests
    #[tokio::test]
    async fn test_constructor_creates_upload_directory() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        assert!(manager.upload_dir().exists());
    }

    #[tokio::test]
    async fn test_constructor_does_not_recreate_existing_directory() {
        let tmp_dir = TempDir::new().unwrap();
        let test_dir = tmp_dir.path().to_path_buf();

        // Create a marker file
        let marker_file = test_dir.join("marker.txt");
        fs::write(&marker_file, b"test").await.unwrap();

        // Create manager - should not delete existing directory
        let manager =
            FileManager::new_with_config(test_dir.clone(), 100 * 1024 * 1024, 12).unwrap();

        // Marker file should still exist
        assert!(marker_file.exists());
        assert_eq!(manager.upload_dir(), test_dir);
    }

    // save_file / addFile tests
    #[tokio::test]
    async fn test_save_file() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let data = b"test content";

        let result = manager
            .save_file("room123", "test.txt", "text/plain", data)
            .await;
        assert!(result.is_ok());

        let file_info = result.unwrap();
        assert_eq!(file_info.original_name, "test.txt");
        assert_eq!(file_info.size, data.len() as u64);
        assert_eq!(file_info.room_key, "room123");
        assert!(file_info.path.exists());
    }

    #[tokio::test]
    async fn test_save_file_tracks_by_room() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let data = b"test content";

        let _file1 = manager
            .save_file("room123", "file1.txt", "text/plain", data)
            .await
            .unwrap();
        let _file2 = manager
            .save_file("room123", "file2.txt", "text/plain", data)
            .await
            .unwrap();
        let _file3 = manager
            .save_file("room456", "file3.txt", "text/plain", data)
            .await
            .unwrap();

        {
            let room_files = manager.room_files.read().unwrap();
            assert_eq!(room_files.get("room123").unwrap().len(), 2);
            assert_eq!(room_files.get("room456").unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn test_save_file_handles_multiple_files_in_same_room() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        let file1 = manager
            .save_file("room123", "test1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        let file2 = manager
            .save_file("room123", "test2.txt", "text/plain", b"content2")
            .await
            .unwrap();

        {
            let room_files = manager.room_files.read().unwrap();
            let files = room_files.get("room123").unwrap();
            assert_eq!(files.len(), 2);
            assert!(files.contains(&file1.filename));
            assert!(files.contains(&file2.filename));
        }
    }

    // get_file tests
    #[tokio::test]
    async fn test_get_file_exists() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let file_info = manager
            .save_file("room123", "test.txt", "text/plain", b"test")
            .await
            .unwrap();

        let retrieved = manager.get_file(&file_info.filename);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().filename, file_info.filename);
    }

    #[tokio::test]
    async fn test_get_file_nonexistent() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let retrieved = manager.get_file("nonexistent.txt");
        assert!(retrieved.is_none());
    }

    // delete_file tests
    #[tokio::test]
    async fn test_delete_file_success() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let file_info = manager
            .save_file("room123", "test.txt", "text/plain", b"test")
            .await
            .unwrap();
        let filename = file_info.filename.clone();
        let path = file_info.path.clone();

        let result = manager.delete_file(&filename).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());

        // File should be removed from tracking
        assert!(manager.get_file(&filename).is_none());

        // Physical file should be deleted
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_delete_file_nonexistent() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let result = manager.delete_file("nonexistent.txt").await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_delete_file_removes_from_room_tracking() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let file_info = manager
            .save_file("room123", "test.txt", "text/plain", b"test")
            .await
            .unwrap();

        manager.delete_file(&file_info.filename).await.unwrap();

        {
            let room_files = manager.room_files.read().unwrap();
            if let Some(files) = room_files.get("room123") {
                assert!(!files.contains(&file_info.filename));
            }
        }
    }

    // delete_room_files tests
    #[tokio::test]
    async fn test_delete_room_files() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        let file1 = manager
            .save_file("room123", "test1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        let file2 = manager
            .save_file("room123", "test2.txt", "text/plain", b"content2")
            .await
            .unwrap();
        let file3 = manager
            .save_file("room456", "test3.txt", "text/plain", b"content3")
            .await
            .unwrap();

        let deleted = manager.delete_room_files("room123");

        assert_eq!(deleted.len(), 2);
        assert!(manager.get_file(&file1.filename).is_none());
        assert!(manager.get_file(&file2.filename).is_none());
        assert!(manager.get_file(&file3.filename).is_some());
    }

    #[tokio::test]
    async fn test_delete_room_files_empty_room() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let deleted = manager.delete_room_files("empty_room");
        assert_eq!(deleted.len(), 0);
    }

    // cleanup_expired_files tests
    #[tokio::test]
    async fn test_cleanup_expired_files() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        // Create a file and manually set it as expired
        let file_info = manager
            .save_file("room123", "old.txt", "text/plain", b"old content")
            .await
            .unwrap();
        {
            let mut files = manager.files.write().unwrap();
            if let Some(info) = files.get_mut(&file_info.filename) {
                info.uploaded_at = Utc::now() - Duration::hours(13); // Older than 12 hours
            }
        }

        let expired = manager.cleanup_expired_files().await;

        assert_eq!(expired.len(), 1);
        assert!(manager.get_file(&file_info.filename).is_none());
    }

    #[tokio::test]
    async fn test_cleanup_keeps_recent_files() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        let recent_file = manager
            .save_file("room123", "new.txt", "text/plain", b"new content")
            .await
            .unwrap();

        let expired = manager.cleanup_expired_files().await;

        assert_eq!(expired.len(), 0);
        assert!(manager.get_file(&recent_file.filename).is_some());
    }

    // get_stats tests
    #[tokio::test]
    async fn test_get_stats() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        manager
            .save_file("room1", "file1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        manager
            .save_file("room2", "file2.txt", "text/plain", b"content22")
            .await
            .unwrap();

        let stats = manager.get_stats();

        assert_eq!(stats.total_files, 2);
        assert_eq!(stats.total_size, 8 + 9); // "content1" + "content22"
        assert_eq!(stats.room_count, 2);
        assert_eq!(stats.deleted_files, 0);
        assert_eq!(stats.deleted_size, 0);
    }

    #[tokio::test]
    async fn test_get_stats_after_deletion() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        let file1 = manager
            .save_file("room1", "file1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        manager
            .save_file("room1", "file2.txt", "text/plain", b"content2")
            .await
            .unwrap();

        manager.delete_file(&file1.filename).await.unwrap();

        let stats = manager.get_stats();

        assert_eq!(stats.total_files, 1);
        assert_eq!(stats.deleted_files, 1);
        assert_eq!(stats.deleted_size, 8); // "content1"
    }

    // File deduplication tests
    #[tokio::test]
    async fn test_file_deduplication_same_content() {
        let (manager, _tmp_dir) = setup_test_manager().await;
        let data = b"identical content";

        let file1 = manager
            .save_file("room1", "file1.txt", "text/plain", data)
            .await
            .unwrap();
        let file2 = manager
            .save_file("room2", "file2.txt", "text/plain", data)
            .await
            .unwrap();

        // Both should have same hash
        assert_eq!(file1.hash, file2.hash);

        // file2 should be marked as duplicate
        assert_eq!(file2.is_duplicate, Some(true));
        assert_eq!(file2.original_file_id, Some(file1.filename.clone()));

        // Both should point to the same physical path
        assert_eq!(file1.path, file2.path);
    }

    #[tokio::test]
    async fn test_file_deduplication_different_content() {
        let (manager, _tmp_dir) = setup_test_manager().await;

        let file1 = manager
            .save_file("room1", "file1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        let file2 = manager
            .save_file("room2", "file2.txt", "text/plain", b"content2")
            .await
            .unwrap();

        // Different content should have different hashes
        assert_ne!(file1.hash, file2.hash);

        // file2 should not be marked as duplicate
        assert_eq!(file2.is_duplicate, Some(false));
        assert_eq!(file2.original_file_id, None);

        // Different physical paths
        assert_ne!(file1.path, file2.path);
    }

    // File size limit test
    #[tokio::test]
    async fn test_file_size_limit() {
        let tmp_dir = TempDir::new().unwrap();
        let manager = FileManager::new_with_config(tmp_dir.path().to_path_buf(), 1024, 12).unwrap(); // 1KB limit

        // Create data larger than max size
        let large_data = vec![0u8; 1025];

        let result = manager
            .save_file(
                "room1",
                "large.bin",
                "application/octet-stream",
                &large_data,
            )
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    // Max file size configuration test
    #[test]
    fn test_max_file_size_default() {
        let tmp_dir = TempDir::new().unwrap();
        let manager =
            FileManager::new_with_config(tmp_dir.path().to_path_buf(), 100 * 1024 * 1024, 12)
                .unwrap();
        assert_eq!(manager.max_file_size(), 100 * 1024 * 1024); // 100MB
    }
}
