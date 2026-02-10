use std::collections::HashMap;
use std::sync::RwLock;

use crate::models::{ShareInfo, ShareAccessLog};
use crate::models::share::ShareInfoResponse;
use crate::utils::generate_share_id;

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
        file_path: String,
        file_name: String,
        file_size: u64,
        room_key: String,
        created_by: String,
        expires_in_days: i64,
        enable_password: bool,
        password: Option<&str>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) -> Result<(ShareInfo, Option<String>), String> {
        let share_id = generate_share_id();

        let (password_hash, generated_password) = if let Some(pwd) = password {
            // User specified a custom password
            (Some(bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?), Some(pwd.to_string()))
        } else if enable_password {
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
            let mut m = metadata.unwrap_or_default();
            m.insert("plainPassword".to_string(), serde_json::Value::String(pwd.clone()));
            Some(m)
        } else {
            metadata
        };

        let share = ShareInfo::new(
            share_id.clone(),
            file_path,
            file_name,
            file_size,
            room_key,
            created_by.clone(),
            expires_in_days,
            password_hash,
            metadata,
        );

        {
            let mut shares = self.shares.write().map_err(|_| "Lock error")?;
            shares.insert(share_id.clone(), share.clone());
        }

        {
            let mut user_shares = self.user_shares.write().map_err(|_| "Lock error")?;
            user_shares
                .entry(created_by)
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
        self.shares.read().ok()?.get(share_id).map(|s| s.to_response())
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
        self.shares.read()
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
                share.access_logs.retain(|log| log.timestamp > thirty_days_ago);
                let removed = before - share.access_logs.len();
                if removed > 0 {
                    tracing::debug!("Cleaned {} old access logs from share {}", removed, share.share_id);
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

    #[test]
    fn test_create_share_no_password() {
        let service = ShareService::new();
        let result = service.create_share(
            "test.txt".into(), "test.txt".into(), 100,
            "room1".into(), "user1".into(), 7,
            false, None, None,
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(!share.has_password());
        assert!(generated_pwd.is_none());
    }

    #[test]
    fn test_create_share_auto_generate_password() {
        let service = ShareService::new();
        let result = service.create_share(
            "test.txt".into(), "test.txt".into(), 100,
            "room1".into(), "user1".into(), 7,
            true, None, None,
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some());
        let pwd = generated_pwd.unwrap();
        assert_eq!(pwd.len(), 6);
    }

    #[test]
    fn test_create_share_custom_password() {
        let service = ShareService::new();
        let result = service.create_share(
            "test.txt".into(), "test.txt".into(), 100,
            "room1".into(), "user1".into(), 7,
            false, Some("mypass123"), None,
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some()); // custom password returned for URL construction
        assert_eq!(generated_pwd.unwrap(), "mypass123");
        assert!(share.verify_password("mypass123"));
        assert!(!share.verify_password("wrong"));
    }

    #[test]
    fn test_create_share_custom_password_overrides_enable() {
        let service = ShareService::new();
        let result = service.create_share(
            "test.txt".into(), "test.txt".into(), 100,
            "room1".into(), "user1".into(), 7,
            true, Some("custom"), None,
        );
        let (share, generated_pwd) = result.unwrap();
        assert!(share.has_password());
        assert!(generated_pwd.is_some()); // custom password returned for URL construction
        assert_eq!(generated_pwd.unwrap(), "custom");
        assert!(share.verify_password("custom"));
    }
}
