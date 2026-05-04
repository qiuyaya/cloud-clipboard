use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Share access log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAccessLog {
    pub timestamp: DateTime<Utc>,
    pub ip_address: String,
    pub user_agent: Option<String>,
    pub success: bool,
    pub bytes_transferred: Option<u64>,
    pub error_message: Option<String>,
}

/// File share information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub share_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub room_key: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub password_hash: Option<String>,
    pub is_active: bool,
    pub access_count: u64,
    pub has_password: bool,
    pub access_logs: Vec<ShareAccessLog>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Share info for API responses (without sensitive data)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfoResponse {
    pub share_id: String,
    pub file_name: String,
    pub file_size: u64,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub is_active: bool,
    pub is_expired: bool,
    pub has_password: bool,
    pub access_count: u64,
    pub created_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<DateTime<Utc>>,
    pub status: String,
}

/// Parameters for creating a new ShareInfo
pub struct ShareInfoParams {
    pub share_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub room_key: String,
    pub created_by: String,
    pub expires_in_days: i64,
    pub password_hash: Option<String>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

impl ShareInfo {
    pub fn new(params: ShareInfoParams) -> Self {
        let now = Utc::now();
        let has_password = params.password_hash.is_some();
        Self {
            share_id: params.share_id,
            file_path: params.file_path,
            file_name: params.file_name,
            file_size: params.file_size,
            room_key: params.room_key,
            created_by: params.created_by,
            created_at: now,
            expires_at: now + chrono::Duration::days(params.expires_in_days),
            password_hash: params.password_hash,
            is_active: true,
            access_count: 0,
            has_password,
            access_logs: Vec::new(),
            metadata: params.metadata,
        }
    }

    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    pub fn has_password(&self) -> bool {
        self.password_hash.is_some()
    }

    pub fn verify_password(&self, password: &str) -> bool {
        match &self.password_hash {
            Some(hash) => bcrypt::verify(password, hash).unwrap_or(false),
            None => true,
        }
    }

    pub fn record_access(
        &mut self,
        ip_address: String,
        success: bool,
        bytes: Option<u64>,
        error: Option<String>,
        user_agent: Option<String>,
    ) {
        self.access_logs.push(ShareAccessLog {
            timestamp: Utc::now(),
            ip_address,
            user_agent,
            success,
            bytes_transferred: bytes,
            error_message: error,
        });
        if success {
            self.access_count += 1;
        }
    }

    pub fn to_response(&self) -> ShareInfoResponse {
        let is_expired = self.is_expired();
        let is_active = self.is_active && !is_expired;
        // Use originalFilename from metadata if available, fallback to file_name
        let display_name = self
            .metadata
            .as_ref()
            .and_then(|m| m.get("originalFilename"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| self.file_name.clone());
        ShareInfoResponse {
            share_id: self.share_id.clone(),
            file_name: display_name,
            file_size: self.file_size,
            created_at: self.created_at,
            expires_at: self.expires_at,
            is_active,
            is_expired,
            has_password: self.has_password(),
            access_count: self.access_count,
            created_by: self.created_by.clone(),
            last_accessed_at: self.access_logs.last().map(|log| log.timestamp),
            status: if is_active {
                "active".to_string()
            } else {
                "expired".to_string()
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_share_info(expires_in_days: i64) -> ShareInfo {
        ShareInfo::new(ShareInfoParams {
            share_id: "share123".to_string(),
            file_path: "/uploads/test.txt".to_string(),
            file_name: "test.txt".to_string(),
            file_size: 1024,
            room_key: "room1".to_string(),
            created_by: "user1".to_string(),
            expires_in_days,
            password_hash: None,
            metadata: None,
        })
    }

    fn make_share_info_with_password(expires_in_days: i64) -> ShareInfo {
        let hash = bcrypt::hash("mypass", bcrypt::DEFAULT_COST).unwrap();
        ShareInfo::new(ShareInfoParams {
            share_id: "share456".to_string(),
            file_path: "/uploads/secret.txt".to_string(),
            file_name: "secret.txt".to_string(),
            file_size: 2048,
            room_key: "room1".to_string(),
            created_by: "user1".to_string(),
            expires_in_days,
            password_hash: Some(hash),
            metadata: None,
        })
    }

    #[test]
    fn new_share_is_active() {
        let share = make_share_info(7);
        assert!(share.is_active);
        assert!(!share.has_password());
        assert_eq!(share.access_count, 0);
        assert!(share.access_logs.is_empty());
        assert_eq!(share.share_id, "share123");
        assert_eq!(share.file_name, "test.txt");
        assert_eq!(share.file_size, 1024);
        assert_eq!(share.room_key, "room1");
        assert_eq!(share.created_by, "user1");
    }

    #[test]
    fn new_share_with_password() {
        let share = make_share_info_with_password(7);
        assert!(share.has_password());
        assert!(share.verify_password("mypass"));
        assert!(!share.verify_password("wrong"));
    }

    #[test]
    fn share_without_password_verifies_any() {
        let share = make_share_info(7);
        assert!(share.verify_password("anything"));
        assert!(share.verify_password(""));
    }

    #[test]
    fn is_expired_future() {
        let share = make_share_info(7);
        assert!(!share.is_expired());
    }

    #[test]
    fn is_expired_past() {
        let share = make_share_info(-1);
        assert!(share.is_expired());
    }

    #[test]
    fn record_access_success_increments_count() {
        let mut share = make_share_info(7);
        share.record_access(
            "1.2.3.4".to_string(),
            true,
            Some(512),
            None,
            Some("Mozilla".to_string()),
        );
        assert_eq!(share.access_count, 1);
        assert_eq!(share.access_logs.len(), 1);
        assert!(share.access_logs[0].success);
        assert_eq!(share.access_logs[0].ip_address, "1.2.3.4");
        assert_eq!(share.access_logs[0].bytes_transferred, Some(512));
        assert_eq!(share.access_logs[0].user_agent, Some("Mozilla".to_string()));
    }

    #[test]
    fn record_access_failure_does_not_increment_count() {
        let mut share = make_share_info(7);
        share.record_access(
            "5.6.7.8".to_string(),
            false,
            None,
            Some("wrong_password".to_string()),
            None,
        );
        assert_eq!(share.access_count, 0);
        assert_eq!(share.access_logs.len(), 1);
        assert!(!share.access_logs[0].success);
        assert_eq!(share.access_logs[0].error_message, Some("wrong_password".to_string()));
    }

    #[test]
    fn to_response_active_share() {
        let share = make_share_info(7);
        let resp = share.to_response();
        assert_eq!(resp.share_id, "share123");
        assert_eq!(resp.file_name, "test.txt");
        assert!(resp.is_active);
        assert!(!resp.is_expired);
        assert!(!resp.has_password);
        assert_eq!(resp.status, "active");
        assert!(resp.last_accessed_at.is_none());
    }

    #[test]
    fn to_response_expired_share() {
        let share = make_share_info(-1);
        let resp = share.to_response();
        assert!(!resp.is_active);
        assert!(resp.is_expired);
        assert_eq!(resp.status, "expired");
    }

    #[test]
    fn to_response_with_metadata_original_filename() {
        let mut share = make_share_info(7);
        let mut meta = HashMap::new();
        meta.insert(
            "originalFilename".to_string(),
            serde_json::Value::String("显示名.txt".to_string()),
        );
        share.metadata = Some(meta);
        let resp = share.to_response();
        assert_eq!(resp.file_name, "显示名.txt");
    }

    #[test]
    fn to_response_with_last_accessed_at() {
        let mut share = make_share_info(7);
        share.record_access("1.2.3.4".to_string(), true, None, None, None);
        let resp = share.to_response();
        assert!(resp.last_accessed_at.is_some());
    }

    #[test]
    fn share_serialization_roundtrip() {
        let share = make_share_info(7);
        let json = serde_json::to_string(&share).unwrap();
        let de: ShareInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(de.share_id, "share123");
        assert_eq!(de.file_name, "test.txt");
    }

    #[test]
    fn access_log_serialization() {
        let log = ShareAccessLog {
            timestamp: Utc::now(),
            ip_address: "1.2.3.4".to_string(),
            user_agent: Some("test".to_string()),
            success: true,
            bytes_transferred: Some(100),
            error_message: None,
        };
        let json = serde_json::to_string(&log).unwrap();
        assert!(json.contains("\"ipAddress\":\"1.2.3.4\""));
        let de: ShareAccessLog = serde_json::from_str(&json).unwrap();
        assert_eq!(de.ip_address, "1.2.3.4");
    }
}
