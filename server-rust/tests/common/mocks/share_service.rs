use cloud_clipboard_server::models::share::ShareInfoResponse;
use cloud_clipboard_server::models::{ShareAccessLog, ShareInfo};
use cloud_clipboard_server::services::share_service::CreateShareRequest;
use cloud_clipboard_server::services::traits::ShareServiceTrait;
use std::sync::Mutex;

pub struct MockShareService {
    shares: Mutex<std::collections::HashMap<String, ShareInfo>>,
    create_share_result: Mutex<Option<Result<(ShareInfo, Option<String>), String>>>,
    delete_share_result: Mutex<Option<Result<Option<ShareInfo>, String>>>,
    revoke_share_result: Mutex<Option<Result<bool, String>>>,
    access_logs: Mutex<std::collections::HashMap<String, Vec<ShareAccessLog>>>,
    record_access_calls: Mutex<Vec<AccessCall>>,
}

#[derive(Debug, Clone)]
pub struct AccessCall {
    pub share_id: String,
    pub ip_address: String,
    pub success: bool,
    pub bytes: Option<u64>,
    pub error: Option<String>,
    pub user_agent: Option<String>,
}

impl MockShareService {
    pub fn new() -> Self {
        Self {
            shares: Mutex::new(std::collections::HashMap::new()),
            create_share_result: Mutex::new(None),
            delete_share_result: Mutex::new(None),
            revoke_share_result: Mutex::new(None),
            access_logs: Mutex::new(std::collections::HashMap::new()),
            record_access_calls: Mutex::new(Vec::new()),
        }
    }

    pub fn add_share(&self, share_id: &str, info: ShareInfo) {
        self.shares
            .lock()
            .unwrap()
            .insert(share_id.to_string(), info);
    }

    pub fn set_create_share_result(&self, result: Result<(ShareInfo, Option<String>), String>) {
        *self.create_share_result.lock().unwrap() = Some(result);
    }

    pub fn set_delete_share_result(&self, result: Result<Option<ShareInfo>, String>) {
        *self.delete_share_result.lock().unwrap() = Some(result);
    }

    pub fn set_revoke_share_result(&self, result: Result<bool, String>) {
        *self.revoke_share_result.lock().unwrap() = Some(result);
    }

    pub fn add_access_logs(&self, share_id: &str, logs: Vec<ShareAccessLog>) {
        self.access_logs
            .lock()
            .unwrap()
            .insert(share_id.to_string(), logs);
    }

    pub fn get_record_access_calls(&self) -> Vec<AccessCall> {
        self.record_access_calls.lock().unwrap().clone()
    }
}

impl ShareServiceTrait for MockShareService {
    fn create_share(&self, _req: CreateShareRequest) -> Result<(ShareInfo, Option<String>), String> {
        if let Some(result) = self.create_share_result.lock().unwrap().take() {
            return result;
        }
        Err("Not implemented".to_string())
    }

    fn get_share(&self, share_id: &str) -> Option<ShareInfo> {
        self.shares.lock().unwrap().get(share_id).cloned()
    }

    fn get_share_info(&self, share_id: &str) -> Option<ShareInfoResponse> {
        self.shares
            .lock()
            .unwrap()
            .get(share_id)
            .map(|s| s.to_response())
    }

    fn get_user_shares(&self, user_id: &str) -> Vec<ShareInfo> {
        self.shares
            .lock()
            .unwrap()
            .values()
            .filter(|s| s.created_by == user_id)
            .cloned()
            .collect()
    }

    fn get_user_shares_response(&self, user_id: &str) -> Vec<ShareInfoResponse> {
        self.get_user_shares(user_id)
            .into_iter()
            .map(|s| s.to_response())
            .collect()
    }

    fn verify_password(&self, share_id: &str, password: &str) -> Result<bool, String> {
        let shares = self.shares.lock().unwrap();
        match shares.get(share_id) {
            Some(share) => Ok(share.verify_password(password)),
            None => Err("Share not found".to_string()),
        }
    }

    fn record_access(
        &self,
        share_id: &str,
        ip_address: String,
        success: bool,
        bytes: Option<u64>,
        error: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), String> {
        self.record_access_calls.lock().unwrap().push(AccessCall {
            share_id: share_id.to_string(),
            ip_address,
            success,
            bytes,
            error,
            user_agent,
        });
        Ok(())
    }

    fn get_access_logs(&self, share_id: &str) -> Vec<ShareAccessLog> {
        self.access_logs
            .lock()
            .unwrap()
            .get(share_id)
            .cloned()
            .unwrap_or_default()
    }

    fn revoke_share(&self, share_id: &str) -> Result<bool, String> {
        if let Some(result) = self.revoke_share_result.lock().unwrap().take() {
            return result;
        }
        // Default: remove from shares map and return true
        self.shares.lock().unwrap().remove(share_id);
        Ok(true)
    }

    fn delete_share(&self, share_id: &str) -> Result<Option<ShareInfo>, String> {
        if let Some(result) = self.delete_share_result.lock().unwrap().take() {
            return result;
        }
        // Default: remove from shares map and return the removed share
        Ok(self.shares.lock().unwrap().remove(share_id))
    }

    fn cleanup_expired_shares(&self) -> Vec<ShareInfo> {
        vec![]
    }
}
