use std::collections::HashMap;
use std::sync::RwLock;

use crate::models::share::{ShareInfoParams, ShareInfoResponse};
use crate::models::{ShareAccessLog, ShareInfo};
use crate::utils::generate_share_id;

/// Request parameters for creating a share
#[derive(Debug, Clone)]
pub struct CreateShareRequest {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub room_key: String,
    pub created_by: String,
    pub expires_in_days: i64,
    pub enable_password: bool,
    pub password: Option<String>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

impl CreateShareRequest {
    /// Create a request with common defaults (7 days expiration, no password)
    pub fn new(
        file_path: impl Into<String>,
        file_name: impl Into<String>,
        file_size: u64,
        room_key: impl Into<String>,
        created_by: impl Into<String>,
    ) -> Self {
        Self {
            file_path: file_path.into(),
            file_name: file_name.into(),
            file_size,
            room_key: room_key.into(),
            created_by: created_by.into(),
            expires_in_days: 7,
            enable_password: false,
            password: None,
            metadata: None,
        }
    }

    pub fn with_expiration(mut self, days: i64) -> Self {
        self.expires_in_days = days;
        self
    }

    pub fn with_auto_password(mut self) -> Self {
        self.enable_password = true;
        self
    }

    pub fn with_password(mut self, password: impl Into<String>) -> Self {
        self.password = Some(password.into());
        self
    }

    pub fn with_metadata(mut self, metadata: HashMap<String, serde_json::Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// Service for managing file shares
pub struct ShareService {
    shares: RwLock<HashMap<String, ShareInfo>>,
    user_shares: RwLock<HashMap<String, Vec<String>>>, // user_id -> [share_id]
}

impl ShareService {
    pub fn new() -> Self {
        Self {
            shares: RwLock::new(HashMap::new()),
            user_shares: RwLock::new(HashMap::new()),
        }
    }

    /// Create a new share
    pub fn create_share(
        &self,
        req: CreateShareRequest,
    ) -> Result<(ShareInfo, Option<String>), String> {
        let share_id = generate_share_id();

        let (password_hash, generated_password) = if let Some(ref pwd) = req.password {
            // User specified a custom password
            (
                Some(bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?),
                Some(pwd.to_string()),
            )
        } else if req.enable_password {
            // User requested auto-generated password
            let pwd = generate_random_password();
            let hash = bcrypt::hash(&pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
            (Some(hash), Some(pwd))
        } else {
            // No password
            (None, None)
        };

        // Store plain password in metadata for URL construction
        let metadata = if let Some(ref pwd) = generated_password {
            let mut m = req.metadata.unwrap_or_default();
            m.insert(
                "plainPassword".to_string(),
                serde_json::Value::String(pwd.clone()),
            );
            Some(m)
        } else {
            req.metadata
        };

        let share = ShareInfo::new(ShareInfoParams {
            share_id: share_id.clone(),
            file_path: req.file_path,
            file_name: req.file_name,
            file_size: req.file_size,
            room_key: req.room_key,
            created_by: req.created_by.clone(),
            expires_in_days: req.expires_in_days,
            password_hash,
            metadata,
        });

        {
            let mut shares = self.shares.write().map_err(|_| "Lock error")?;
            shares.insert(share_id.clone(), share.clone());
        }

        {
            let mut user_shares = self.user_shares.write().map_err(|_| "Lock error")?;
            user_shares
                .entry(req.created_by)
                .or_default()
                .push(share_id);
        }

        tracing::info!("Share created: {}", share.share_id);
        Ok((share, generated_password))
    }

    /// Get share by ID
    pub fn get_share(&self, share_id: &str) -> Option<ShareInfo> {
        self.shares.read().ok()?.get(share_id).cloned()
    }

    /// Get share info for response (without sensitive data)
    pub fn get_share_info(&self, share_id: &str) -> Option<ShareInfoResponse> {
        self.shares
            .read()
            .ok()?
            .get(share_id)
            .map(|s| s.to_response())
    }

    /// Get all shares for a user (with full ShareInfo for filtering)
    pub fn get_user_shares(&self, user_id: &str) -> Vec<ShareInfo> {
        // Unified lock order: shares → user_shares
        // First acquire shares read lock, then user_shares
        let shares = match self.shares.read() {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let share_ids = {
            let user_shares = match self.user_shares.read() {
                Ok(us) => us,
                Err(_) => return Vec::new(),
            };
            user_shares.get(user_id).cloned().unwrap_or_default()
        };

        share_ids
            .iter()
            .filter_map(|id| shares.get(id).cloned())
            .collect()
    }

    /// Get all shares for a user (as responses)
    pub fn get_user_shares_response(&self, user_id: &str) -> Vec<ShareInfoResponse> {
        self.get_user_shares(user_id)
            .into_iter()
            .map(|s| s.to_response())
            .collect()
    }

    /// Verify share password
    pub fn verify_password(&self, share_id: &str, password: &str) -> Result<bool, String> {
        let shares = self.shares.read().map_err(|_| "Lock error")?;
        match shares.get(share_id) {
            Some(share) => Ok(share.verify_password(password)),
            None => Err("Share not found".to_string()),
        }
    }

    /// Record access to a share
    pub fn record_access(
        &self,
        share_id: &str,
        ip_address: String,
        success: bool,
        bytes: Option<u64>,
        error: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), String> {
        let mut shares = self.shares.write().map_err(|_| "Lock error")?;
        match shares.get_mut(share_id) {
            Some(share) => {
                share.record_access(ip_address, success, bytes, error, user_agent);
                Ok(())
            }
            None => Err("Share not found".to_string()),
        }
    }

    /// Get access logs for a share
    pub fn get_access_logs(&self, share_id: &str) -> Vec<ShareAccessLog> {
        self.shares
            .read()
            .ok()
            .and_then(|shares| shares.get(share_id).map(|s| s.access_logs.clone()))
            .unwrap_or_default()
    }

    /// Revoke a share (mark as inactive but keep record)
    pub fn revoke_share(&self, share_id: &str) -> Result<bool, String> {
        let mut shares = self.shares.write().map_err(|_| "Lock error")?;
        match shares.get_mut(share_id) {
            Some(share) => {
                share.is_active = false;
                tracing::info!("Share revoked: {}", share_id);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Delete a share
    pub fn delete_share(&self, share_id: &str) -> Result<Option<ShareInfo>, String> {
        let share = {
            let mut shares = self.shares.write().map_err(|_| "Lock error")?;
            shares.remove(share_id)
        };

        if let Some(ref s) = share {
            let mut user_shares = self.user_shares.write().map_err(|_| "Lock error")?;
            if let Some(shares) = user_shares.get_mut(&s.created_by) {
                shares.retain(|id| id != share_id);
            }
            tracing::info!("Share deleted: {}", share_id);
        }

        Ok(share)
    }

    /// Cleanup expired shares
    pub fn cleanup_expired_shares(&self) -> Vec<ShareInfo> {
        // Collect expired share IDs first (avoid nested locking)
        let expired_ids: Vec<String> = {
            let shares = match self.shares.read() {
                Ok(s) => s,
                Err(_) => return Vec::new(),
            };
            shares
                .iter()
                .filter(|(_, s)| s.is_expired())
                .map(|(id, _)| id.clone())
                .collect()
        };

        // Delete shares one by one (delete_share handles its own locking)
        let mut expired = Vec::new();
        for id in expired_ids {
            if let Ok(Some(share)) = self.delete_share(&id) {
                expired.push(share);
            }
        }

        if !expired.is_empty() {
            tracing::info!("Cleaned up {} expired shares", expired.len());
        }

        // Clean up access logs older than 30 days
        let thirty_days_ago = chrono::Utc::now() - chrono::Duration::days(30);
        if let Ok(mut shares) = self.shares.write() {
            for share in shares.values_mut() {
                let before = share.access_logs.len();
                share
                    .access_logs
                    .retain(|log| log.timestamp > thirty_days_ago);
                let removed = before - share.access_logs.len();
                if removed > 0 {
                    tracing::debug!(
                        "Cleaned {} old access logs from share {}",
                        removed,
                        share.share_id
                    );
                }
            }
        }

        expired
    }
}

impl Default for ShareService {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate random 6-character password
fn generate_random_password() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..6)
        .map(|_| {
            let idx = rng.random_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, Utc};

    // createShare tests
    #[test]
    fn test_create_share_no_password() {
        let service = ShareService::new();
        let result = service.create_share(CreateShareRequest::new(
            "test.txt", "test.txt", 100, "room1", "user1",
        ));
        let (share, generated_pwd) = result.unwrap();
        assert!(!share.has_password());
        assert!(generated_pwd.is_none());
        assert_eq!(share.access_count, 0);
        assert!(share.is_active);
        assert_eq!(share.created_by, "user1");
    }

    #[test]
    fn test_create_share_auto_generate_password() {
        let service = ShareService::new();
        let result = service.create_share(
            CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                .with_auto_password(),
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some());
        let pwd = generated_pwd.unwrap();
        assert_eq!(pwd.len(), 6);
        assert_eq!(share.access_count, 0);
        assert!(share.is_active);
        assert_eq!(share.created_by, "user1");
    }

    #[test]
    fn test_create_share_custom_password() {
        let service = ShareService::new();
        let result = service.create_share(
            CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                .with_password("mypass123"),
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some());
        assert_eq!(generated_pwd.unwrap(), "mypass123");
        assert!(share.verify_password("mypass123"));
        assert!(!share.verify_password("wrong"));
    }

    #[test]
    fn test_create_share_custom_password_overrides_enable() {
        let service = ShareService::new();
        let result = service.create_share(
            CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                .with_password("custom"),
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some());
        assert_eq!(generated_pwd.unwrap(), "custom");
        assert!(share.verify_password("custom"));
    }

    #[test]
    fn test_create_share_default_expiration() {
        let service = ShareService::new();
        let before = Utc::now();
        let result = service.create_share(CreateShareRequest::new(
            "test.txt", "test.txt", 100, "room1", "user1",
        ));
        let after = Utc::now();
        let (share, _) = result.unwrap();

        let expected_expiry = before + Duration::days(7);
        let delta = (share.expires_at - expected_expiry).num_seconds().abs();
        assert!(delta < 5, "Expiry should be ~7 days from now");
        assert!(share.expires_at <= after + Duration::days(7));
    }

    // validateShare / get_share tests
    #[test]
    fn test_get_share_exists() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let retrieved = service.get_share(&share.share_id);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().share_id, share.share_id);
    }

    #[test]
    fn test_get_share_nonexistent() {
        let service = ShareService::new();
        let retrieved = service.get_share("nonexistent");
        assert!(retrieved.is_none());
    }

    #[test]
    fn test_get_share_info_valid() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let info = service.get_share_info(&share.share_id);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.share_id, share.share_id);
        assert_eq!(info.file_name, "test.txt");
    }

    // record_access tests
    #[test]
    fn test_record_access_success() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let result = service.record_access(
            &share.share_id,
            "192.168.1.1".to_string(),
            true,
            Some(1024),
            None,
            Some("Mozilla/5.0".to_string()),
        );
        assert!(result.is_ok());

        let logs = service.get_access_logs(&share.share_id);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].ip_address, "192.168.1.1");
        assert!(logs[0].success);
        assert_eq!(logs[0].bytes_transferred, Some(1024));
    }

    #[test]
    fn test_record_access_failure() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let result = service.record_access(
            &share.share_id,
            "192.168.1.2".to_string(),
            false,
            None,
            Some("wrong_password".to_string()),
            None,
        );
        assert!(result.is_ok());

        let logs = service.get_access_logs(&share.share_id);
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
        assert_eq!(logs[0].error_message, Some("wrong_password".to_string()));
    }

    #[test]
    fn test_record_access_nonexistent() {
        let service = ShareService::new();
        let result = service.record_access(
            "nonexistent",
            "192.168.1.1".to_string(),
            true,
            None,
            None,
            None,
        );
        assert!(result.is_err());
    }

    // getUserShares tests
    #[test]
    fn test_get_user_shares() {
        let service = ShareService::new();

        service
            .create_share(CreateShareRequest::new(
                "file1.txt",
                "file1.txt",
                100,
                "room1",
                "user123",
            ))
            .unwrap();

        service
            .create_share(CreateShareRequest::new(
                "file2.txt",
                "file2.txt",
                200,
                "room1",
                "user456",
            ))
            .unwrap();

        service
            .create_share(CreateShareRequest::new(
                "file3.txt",
                "file3.txt",
                300,
                "room1",
                "user123",
            ))
            .unwrap();

        let user123_shares = service.get_user_shares("user123");
        let user456_shares = service.get_user_shares("user456");

        assert_eq!(user123_shares.len(), 2);
        assert_eq!(user456_shares.len(), 1);
    }

    #[test]
    fn test_get_user_shares_empty() {
        let service = ShareService::new();
        let shares = service.get_user_shares("nonexistent");
        assert_eq!(shares.len(), 0);
    }

    // revoke_share tests
    #[test]
    fn test_revoke_share() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let result = service.revoke_share(&share.share_id);
        assert!(result.is_ok());
        assert!(result.unwrap());

        let revoked = service.get_share(&share.share_id).unwrap();
        assert!(!revoked.is_active);
    }

    #[test]
    fn test_revoke_share_nonexistent() {
        let service = ShareService::new();
        let result = service.revoke_share("nonexistent");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    // delete_share tests
    #[test]
    fn test_delete_share() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        let result = service.delete_share(&share.share_id);
        assert!(result.is_ok());
        assert!(result.unwrap().is_some());

        let deleted = service.get_share(&share.share_id);
        assert!(deleted.is_none());
    }

    #[test]
    fn test_delete_share_nonexistent() {
        let service = ShareService::new();
        let result = service.delete_share("nonexistent");
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    // cleanup tests
    #[test]
    fn test_cleanup_expired_shares() {
        let service = ShareService::new();

        // Create an active share (7 days expiry)
        let (active_share, _) = service
            .create_share(CreateShareRequest::new(
                "active.txt",
                "active.txt",
                100,
                "room1",
                "user1",
            ))
            .unwrap();

        // Create an expired share (manually set expiry to past)
        let (expired_share, _) = service
            .create_share(
                CreateShareRequest::new("expired.txt", "expired.txt", 100, "room1", "user1")
                    .with_expiration(-1),
            )
            .unwrap();

        // Run cleanup
        let expired = service.cleanup_expired_shares();

        assert_eq!(expired.len(), 1);
        assert!(service.get_share(&active_share.share_id).is_some());
        assert!(service.get_share(&expired_share.share_id).is_none());
    }

    #[test]
    fn test_cleanup_old_access_logs() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        // Add a recent access log
        service
            .record_access(
                &share.share_id,
                "192.168.1.1".to_string(),
                true,
                Some(1024),
                None,
                None,
            )
            .unwrap();

        // Manually add an old access log (simulate 35 days old)
        {
            let mut shares = service.shares.write().unwrap();
            if let Some(s) = shares.get_mut(&share.share_id) {
                let old_log = ShareAccessLog {
                    timestamp: Utc::now() - Duration::days(35),
                    ip_address: "192.168.1.2".to_string(),
                    success: true,
                    bytes_transferred: Some(512),
                    error_message: None,
                    user_agent: None,
                };
                s.access_logs.push(old_log);
            }
        }

        // Before cleanup: 2 logs
        assert_eq!(service.get_access_logs(&share.share_id).len(), 2);

        // Run cleanup
        service.cleanup_expired_shares();

        // After cleanup: only recent log remains
        assert_eq!(service.get_access_logs(&share.share_id).len(), 1);
    }

    // verify_password tests
    #[test]
    fn test_verify_password_correct() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_password("password123"),
            )
            .unwrap();

        let result = service.verify_password(&share.share_id, "password123");
        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[test]
    fn test_verify_password_incorrect() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_password("password123"),
            )
            .unwrap();

        let result = service.verify_password(&share.share_id, "wrongpass");
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn test_verify_password_nonexistent() {
        let service = ShareService::new();
        let result = service.verify_password("nonexistent", "password");
        assert!(result.is_err());
    }
}
