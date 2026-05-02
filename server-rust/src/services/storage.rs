use async_trait::async_trait;
use std::path::PathBuf;

/// Errors that can occur during storage operations
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("File not found: {0}")]
    NotFound(String),

    #[error("Storage full: {0}")]
    StorageFull(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Abstraction over file storage backends (local filesystem, S3, etc.)
#[async_trait]
pub trait StorageBackend: Send + Sync {
    /// Write data to storage, returning the path/key where it was stored
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError>;

    /// Read data from storage
    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError>;

    /// Delete a file from storage
    async fn delete(&self, key: &str) -> Result<bool, StorageError>;

    /// Check if a file exists
    async fn exists(&self, key: &str) -> Result<bool, StorageError>;

    /// Get the full path/URL for a stored file (for serving to clients)
    fn resolve_path(&self, key: &str) -> PathBuf;
}

/// Local filesystem storage backend
pub struct LocalStorage {
    base_dir: PathBuf,
}

impl LocalStorage {
    pub fn new(base_dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir })
    }
}

#[async_trait]
impl StorageBackend for LocalStorage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        let path = self.base_dir.join(key);
        tokio::fs::write(&path, data).await?;
        Ok(())
    }

    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        let path = self.base_dir.join(key);
        if !path.exists() {
            return Err(StorageError::NotFound(key.to_string()));
        }
        Ok(tokio::fs::read(&path).await?)
    }

    async fn delete(&self, key: &str) -> Result<bool, StorageError> {
        let path = self.base_dir.join(key);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        Ok(self.base_dir.join(key).exists())
    }

    fn resolve_path(&self, key: &str) -> PathBuf {
        self.base_dir.join(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_storage() -> (LocalStorage, TempDir) {
        let tmp_dir = TempDir::new().expect("Failed to create temp dir");
        let storage =
            LocalStorage::new(tmp_dir.path().to_path_buf()).expect("Failed to create storage");
        (storage, tmp_dir)
    }

    #[tokio::test]
    async fn test_local_storage_write_read() {
        let (storage, _tmp) = create_test_storage();

        let data = b"hello, cloud clipboard!";
        storage
            .write("test.txt", data)
            .await
            .expect("write failed");

        let read_data = storage.read("test.txt").await.expect("read failed");
        assert_eq!(read_data, data);
    }

    #[tokio::test]
    async fn test_local_storage_delete() {
        let (storage, _tmp) = create_test_storage();

        // Write a file first
        storage
            .write("to_delete.txt", b"delete me")
            .await
            .expect("write failed");
        assert!(storage.exists("to_delete.txt").await.expect("exists failed"));

        // Delete should return true
        let deleted = storage
            .delete("to_delete.txt")
            .await
            .expect("delete failed");
        assert!(deleted);

        // File should no longer exist
        assert!(!storage.exists("to_delete.txt").await.expect("exists failed"));

        // Deleting again should return false
        let deleted_again = storage
            .delete("to_delete.txt")
            .await
            .expect("delete failed");
        assert!(!deleted_again);
    }

    #[tokio::test]
    async fn test_local_storage_not_found() {
        let (storage, _tmp) = create_test_storage();

        let result = storage.read("nonexistent.txt").await;
        assert!(result.is_err());
        match result.unwrap_err() {
            StorageError::NotFound(key) => assert_eq!(key, "nonexistent.txt"),
            other => panic!("Expected NotFound error, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_local_storage_exists() {
        let (storage, _tmp) = create_test_storage();

        // File does not exist yet
        assert!(!storage
            .exists("check_me.txt")
            .await
            .expect("exists failed"));

        // Write the file
        storage
            .write("check_me.txt", b"I exist")
            .await
            .expect("write failed");

        // Now it should exist
        assert!(storage
            .exists("check_me.txt")
            .await
            .expect("exists failed"));

        // resolve_path should return the correct path
        let resolved = storage.resolve_path("check_me.txt");
        assert!(resolved.ends_with("check_me.txt"));
    }
}
