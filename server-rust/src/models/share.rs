use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

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

impl ShareInfo {
    pub fn new(
        share_id: String,
        file_path: String,
        file_name: String,
        file_size: u64,
        room_key: String,
        created_by: String,
        expires_in_days: i64,
        password_hash: Option<String>,
    ) -> Self {
        let now = Utc::now();
        let has_password = password_hash.is_some();
        Self {
            share_id,
            file_path,
            file_name,
            file_size,
            room_key,
            created_by,
            created_at: now,
            expires_at: now + chrono::Duration::days(expires_in_days),
            password_hash,
            is_active: true,
            access_count: 0,
            has_password,
            access_logs: Vec::new(),
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

    pub fn record_access(&mut self, ip_address: String, success: bool, bytes: Option<u64>, error: Option<String>, user_agent: Option<String>) {
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
        ShareInfoResponse {
            share_id: self.share_id.clone(),
            file_name: self.file_name.clone(),
            file_size: self.file_size,
            created_at: self.created_at,
            expires_at: self.expires_at,
            is_active,
            is_expired,
            has_password: self.has_password(),
            access_count: self.access_count,
            created_by: self.created_by.clone(),
            last_accessed_at: self.access_logs.last().map(|log| log.timestamp),
            status: if is_active { "active".to_string() } else { "expired".to_string() },
        }
    }
}
