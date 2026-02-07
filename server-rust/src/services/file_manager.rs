use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use chrono::{DateTime, Duration, Utc};
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
}

/// File manager service
pub struct FileManager {
    upload_dir: PathBuf,
    files: RwLock<HashMap<String, FileInfo>>,
    room_files: RwLock<HashMap<String, Vec<String>>>, // room_key -> [filename]
    max_file_size: u64,
    retention_hours: i64,
}

impl FileManager {
    pub fn new() -> anyhow::Result<Self> {
        let upload_dir = std::env::var("UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./uploads"));

        // Create upload directory if it doesn't exist
        std::fs::create_dir_all(&upload_dir)?;

        let max_file_size = std::env::var("MAX_FILE_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(100 * 1024 * 1024); // 100MB default

        let retention_hours = std::env::var("FILE_RETENTION_HOURS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(12);

        Ok(Self {
            upload_dir,
            files: RwLock::new(HashMap::new()),
            room_files: RwLock::new(HashMap::new()),
            max_file_size,
            retention_hours,
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

    /// Save uploaded file
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
        };

        // Track file
        {
            let mut files = self.files.write().map_err(|_| anyhow::anyhow!("Lock error"))?;
            files.insert(filename.clone(), file_info.clone());
        }

        {
            let mut room_files = self.room_files.write().map_err(|_| anyhow::anyhow!("Lock error"))?;
            room_files
                .entry(room_key.to_string())
                .or_default()
                .push(filename);
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
        self.files.read().ok()?.get(filename).map(|f| f.path.clone())
    }

    /// Delete a file
    pub async fn delete_file(&self, filename: &str) -> anyhow::Result<Option<FileInfo>> {
        let file_info = {
            let mut files = self.files.write().map_err(|_| anyhow::anyhow!("Lock error"))?;
            files.remove(filename)
        };

        if let Some(ref info) = file_info {
            // Remove from room tracking
            if let Ok(mut room_files) = self.room_files.write() {
                if let Some(files) = room_files.get_mut(&info.room_key) {
                    files.retain(|f| f != filename);
                }
            }

            // Delete physical file
            if info.path.exists() {
                fs::remove_file(&info.path).await?;
            }

            tracing::info!("File deleted: {}", filename);
        }

        Ok(file_info)
    }

    /// Delete all files for a room
    pub fn delete_room_files(&self, room_key: &str) -> Vec<FileInfo> {
        let filenames = {
            let mut room_files = match self.room_files.write() {
                Ok(rf) => rf,
                Err(_) => return Vec::new(),
            };
            room_files.remove(room_key).unwrap_or_default()
        };

        let mut deleted = Vec::new();
        let mut files = match self.files.write() {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        for filename in filenames {
            if let Some(info) = files.remove(&filename) {
                // Delete physical file (sync for simplicity in this context)
                let _ = std::fs::remove_file(&info.path);
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
        let mut expired = Vec::new();

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
        let files = self.files.read().unwrap();
        let total_size: u64 = files.values().map(|f| f.size).sum();

        FileStats {
            total_files: files.len(),
            total_size,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStats {
    pub total_files: usize,
    pub total_size: u64,
}
