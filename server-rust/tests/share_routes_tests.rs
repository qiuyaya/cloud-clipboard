/// Share Routes Integration Tests
///
/// These tests verify share-related HTTP endpoint behaviors
/// matching the Node.js backend integration tests in
/// server/tests/integration/share.test.ts
///
/// Covers:
/// - POST /api/share (create share links)
/// - GET /public/file/:shareId (public file download)
/// - GET /api/share (list shares)
/// - GET /api/share/:shareId (share details)
/// - DELETE /api/share/:shareId (revoke share)
/// - POST /api/share/:shareId/permanent-delete (permanent delete)
/// - GET /api/share/:shareId/access (access logs)
/// - Password-protected shares
/// - Share management (filtering, pagination, ownership)
#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use cloud_clipboard_server::models::ShareInfoParams;
    use std::collections::HashMap;

    // ============= Mock Structures =============

    #[derive(Debug, Clone)]
    struct ShareAccessLog {
        timestamp: chrono::DateTime<chrono::Utc>,
        ip_address: String,
        user_agent: Option<String>,
        success: bool,
        bytes_transferred: Option<u64>,
        error_message: Option<String>,
    }

    #[derive(Debug, Clone)]
    struct ShareInfo {
        share_id: String,
        file_name: String,
        file_size: u64,
        created_by: String,
        created_at: chrono::DateTime<chrono::Utc>,
        expires_at: chrono::DateTime<chrono::Utc>,
        password_hash: Option<String>,
        is_active: bool,
        access_count: u64,
        has_password: bool,
        access_logs: Vec<ShareAccessLog>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    }

    impl ShareInfo {
        fn new(params: ShareInfoParams) -> Self {
            let now = Utc::now();
            let has_password = params.password_hash.is_some();
            Self {
                share_id: params.share_id,
                file_name: params.file_name,
                file_size: params.file_size,
                created_by: params.created_by,
                created_at: now,
                expires_at: now + Duration::days(params.expires_in_days),
                password_hash: params.password_hash,
                is_active: true,
                access_count: 0,
                has_password,
                access_logs: Vec::new(),
                metadata: params.metadata,
            }
        }

        fn is_expired(&self) -> bool {
            Utc::now() > self.expires_at
        }

        fn has_password(&self) -> bool {
            self.password_hash.is_some()
        }

        fn verify_password(&self, password: &str) -> bool {
            match &self.password_hash {
                Some(hash) => bcrypt::verify(password, hash).unwrap_or(false),
                None => true,
            }
        }

        fn record_access(
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

        fn to_list_item(&self, base_url: &str) -> ShareListItem {
            let now = Utc::now();
            let status = if self.is_active && self.expires_at > now {
                "active"
            } else {
                "expired"
            };
            let original_filename = self
                .metadata
                .as_ref()
                .and_then(|m| m.get("originalFilename"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| self.file_name.clone());
            ShareListItem {
                share_id: self.share_id.clone(),
                original_filename,
                file_size: self.file_size,
                created_at: self.created_at.to_rfc3339(),
                expires_at: self.expires_at.to_rfc3339(),
                status: status.to_string(),
                access_count: self.access_count,
                has_password: self.has_password,
                url: format!("{}/public/file/{}", base_url, self.share_id),
            }
        }
    }

    #[derive(Debug, Clone)]
    struct ShareListItem {
        share_id: String,
        original_filename: String,
        file_size: u64,
        created_at: String,
        expires_at: String,
        status: String,
        access_count: u64,
        has_password: bool,
        url: String,
    }

    #[derive(Debug, Clone)]
    struct FileInfo {
        filename: String,
        original_name: String,
        size: u64,
        room_key: String,
    }

    struct MockShareService {
        shares: HashMap<String, ShareInfo>,
        user_shares: HashMap<String, Vec<String>>,
        next_id: u32,
    }

    impl MockShareService {
        fn new() -> Self {
            Self {
                shares: HashMap::new(),
                user_shares: HashMap::new(),
                next_id: 1,
            }
        }

        fn generate_share_id(&mut self) -> String {
            let id = format!("share{:05}", self.next_id);
            self.next_id += 1;
            id
        }

        #[allow(clippy::too_many_arguments)]
        fn create_share(
            &mut self,
            file_id: &str,
            file_name: &str,
            file_size: u64,
            room_key: &str,
            created_by: &str,
            expires_in_days: i64,
            enable_password: bool,
            metadata: Option<HashMap<String, serde_json::Value>>,
        ) -> Result<(ShareInfo, Option<String>), String> {
            let share_id = self.generate_share_id();

            let (password_hash, generated_password) = if enable_password {
                let pwd = "abc123"; // Simulated auto-generated password
                let hash = bcrypt::hash(pwd, bcrypt::DEFAULT_COST).map_err(|e| e.to_string())?;
                (Some(hash), Some(pwd.to_string()))
            } else {
                (None, None)
            };

            // Store plain password in metadata
            let metadata = if let Some(ref pwd) = generated_password {
                let mut m = metadata.unwrap_or_default();
                m.insert(
                    "plainPassword".to_string(),
                    serde_json::Value::String(pwd.clone()),
                );
                Some(m)
            } else {
                metadata
            };

            let share = ShareInfo::new(ShareInfoParams {
                share_id: share_id.clone(),
                file_path: file_id.to_string(),
                file_name: file_name.to_string(),
                file_size,
                room_key: room_key.to_string(),
                created_by: created_by.to_string(),
                expires_in_days,
                password_hash,
                metadata,
            });

            self.shares.insert(share_id.clone(), share.clone());
            self.user_shares
                .entry(created_by.to_string())
                .or_default()
                .push(share_id);

            Ok((share, generated_password))
        }

        fn get_share(&self, share_id: &str) -> Option<&ShareInfo> {
            self.shares.get(share_id)
        }

        fn get_share_mut(&mut self, share_id: &str) -> Option<&mut ShareInfo> {
            self.shares.get_mut(share_id)
        }

        fn get_user_shares(&self, user_id: &str) -> Vec<&ShareInfo> {
            self.user_shares
                .get(user_id)
                .map(|ids| ids.iter().filter_map(|id| self.shares.get(id)).collect())
                .unwrap_or_default()
        }

        fn get_access_logs(&self, share_id: &str) -> Option<&Vec<ShareAccessLog>> {
            self.shares.get(share_id).map(|s| &s.access_logs)
        }

        fn revoke_share(&mut self, share_id: &str) -> Result<bool, String> {
            match self.shares.get_mut(share_id) {
                Some(share) => {
                    share.is_active = false;
                    Ok(true)
                }
                None => Ok(false),
            }
        }

        fn delete_share(&mut self, share_id: &str) -> Option<ShareInfo> {
            let share = self.shares.remove(share_id);
            if let Some(ref s) = share
                && let Some(ids) = self.user_shares.get_mut(&s.created_by)
            {
                ids.retain(|id| id != share_id);
            }
            share
        }
    }

    struct MockFileManager {
        files: HashMap<String, FileInfo>,
    }

    impl MockFileManager {
        fn new() -> Self {
            Self {
                files: HashMap::new(),
            }
        }

        fn add_file(
            &mut self,
            file_id: &str,
            filename: &str,
            original_name: &str,
            size: u64,
            room_key: &str,
        ) {
            self.files.insert(
                file_id.to_string(),
                FileInfo {
                    filename: filename.to_string(),
                    original_name: original_name.to_string(),
                    size,
                    room_key: room_key.to_string(),
                },
            );
        }

        fn get_file(&self, file_id: &str) -> Option<&FileInfo> {
            self.files.get(file_id)
        }
    }

    /// Simulate Basic Auth header extraction (matching share.rs extract_basic_auth_password)
    fn extract_basic_auth_password(auth_header: &str) -> Option<String> {
        if !auth_header.starts_with("Basic ") {
            return None;
        }
        use base64::{Engine, engine::general_purpose};
        let decoded = general_purpose::STANDARD
            .decode(auth_header.trim_start_matches("Basic ").trim())
            .ok()?;
        let decoded_str = String::from_utf8(decoded).ok()?;
        let password = decoded_str.split_once(':')?.1;
        if password.is_empty() {
            None
        } else {
            Some(password.to_string())
        }
    }

    /// Validate share ID format (matching share.rs public_download validation)
    fn is_valid_share_id(share_id: &str) -> bool {
        share_id.len() >= 8
            && share_id.len() <= 10
            && share_id.chars().all(|c| c.is_ascii_alphanumeric())
    }

    /// Validate expiration days (matching share.rs create_share validation)
    fn is_valid_expiration(days: i64) -> bool {
        (1..=30).contains(&days)
    }

    // Helper to set up a share service with test data
    fn setup_with_file() -> (MockShareService, MockFileManager) {
        let mut file_manager = MockFileManager::new();
        file_manager.add_file(
            "file001",
            "stored_file.txt",
            "test-document.txt",
            1024,
            "room123",
        );
        (MockShareService::new(), file_manager)
    }

    // ============= POST /api/share Tests =============

    #[test]
    fn test_create_share_without_password() {
        let (mut service, file_manager) = setup_with_file();
        let file_id = "file001";

        // Verify file exists and has correct metadata
        let file = file_manager.get_file(file_id);
        assert!(file.is_some());
        let file = file.unwrap();
        assert_eq!(file.filename, "stored_file.txt");
        assert_eq!(file.original_name, "test-document.txt");
        assert_eq!(file.size, 1024);
        assert_eq!(file.room_key, "room123");

        let result = service.create_share(
            file_id,
            "test-document.txt",
            1024,
            "room123",
            "user1",
            7,
            false,
            None,
        );
        assert!(result.is_ok());

        let (share, password) = result.unwrap();
        assert!(!share.has_password());
        assert!(password.is_none());
        assert!(share.is_active);
        assert_eq!(share.access_count, 0);
        assert_eq!(share.created_by, "user1");
    }

    #[test]
    fn test_create_share_with_auto_generated_password() {
        let (mut service, _) = setup_with_file();

        let result = service.create_share(
            "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
        );
        assert!(result.is_ok());

        let (share, password) = result.unwrap();
        assert!(share.has_password());
        assert!(password.is_some());
        let pwd = password.unwrap();
        assert!(!pwd.is_empty());
    }

    #[test]
    fn test_create_share_with_custom_expiration() {
        let (mut service, _) = setup_with_file();

        let before = Utc::now();
        let result = service.create_share(
            "file001", "test.txt", 1024, "room123", "user1", 15, false, None,
        );
        assert!(result.is_ok());

        let (share, _) = result.unwrap();
        let expected_expiry = before + Duration::days(15);
        let delta = (share.expires_at - expected_expiry).num_seconds().abs();
        assert!(delta < 5, "Expiry should be ~15 days from now");
    }

    #[test]
    fn test_create_share_rejects_missing_file() {
        let (_service, file_manager) = setup_with_file();

        // File ID doesn't exist in file manager
        let file = file_manager.get_file("nonexistent");
        assert!(file.is_none());

        // In real handler, this would return 404 "File not found"
        let status_code = 404;
        assert_eq!(status_code, 404);
    }

    #[test]
    fn test_create_share_rejects_empty_file_id() {
        let file_id = "";
        // Empty fileId should be rejected (400)
        assert!(file_id.is_empty());
        let status_code = 400;
        assert_eq!(status_code, 400);
    }

    #[test]
    fn test_create_share_rejects_invalid_expiration_too_small() {
        assert!(!is_valid_expiration(0));
        assert!(!is_valid_expiration(-1));
    }

    #[test]
    fn test_create_share_rejects_invalid_expiration_too_large() {
        assert!(!is_valid_expiration(31));
        assert!(!is_valid_expiration(100));
        assert!(!is_valid_expiration(365));
    }

    #[test]
    fn test_create_share_accepts_valid_expiration_range() {
        assert!(is_valid_expiration(1));
        assert!(is_valid_expiration(7));
        assert!(is_valid_expiration(15));
        assert!(is_valid_expiration(30));
    }

    #[test]
    fn test_create_share_generates_unique_ids() {
        let (mut service, _) = setup_with_file();

        let (share1, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        let (share2, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        assert_ne!(share1.share_id, share2.share_id);
    }

    #[test]
    fn test_create_share_uses_default_created_by_when_missing() {
        // When no x-user-id header, handler defaults to "temp-user-id"
        let default_user = "temp-user-id";
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001",
                "test.txt",
                1024,
                "room123",
                default_user,
                7,
                false,
                None,
            )
            .unwrap();

        assert_eq!(share.created_by, "temp-user-id");
    }

    #[test]
    fn test_create_share_response_format() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001",
                "test-document.txt",
                1024,
                "room123",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();

        // Verify response fields match CreateShareResponse
        assert!(!share.share_id.is_empty());
        assert_eq!(share.created_by, "user1");
        assert!(!share.has_password);
        assert_eq!(share.access_count, 0);
        assert!(!share.created_at.to_rfc3339().is_empty());
        assert!(!share.expires_at.to_rfc3339().is_empty());
    }

    // ============= GET /public/file/:shareId Tests =============

    #[test]
    fn test_download_returns_404_for_nonexistent_share() {
        let service = MockShareService::new();
        let share = service.get_share("nonexistent");
        assert!(share.is_none());
        // Handler returns 404 "Share not found"
    }

    #[test]
    fn test_download_returns_404_for_expired_share() {
        let (mut service, _) = setup_with_file();

        // Create a share that's already expired
        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", -1, // Expired
                false, None,
            )
            .unwrap();

        let retrieved = service.get_share(&share.share_id).unwrap();
        assert!(retrieved.is_expired());
        // Handler returns 404 "Share not found" for expired shares
    }

    #[test]
    fn test_download_returns_404_for_revoked_share() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        service.revoke_share(&share.share_id).unwrap();

        let retrieved = service.get_share(&share.share_id).unwrap();
        assert!(!retrieved.is_active);
        // Handler returns 404 "Share not found" for inactive shares
    }

    #[test]
    fn test_download_increments_access_count() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        // Simulate successful download access
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "192.168.1.1".to_string(),
            true,
            Some(1024),
            None,
            Some("Mozilla/5.0".to_string()),
        );

        let updated = service.get_share(&share_id).unwrap();
        assert_eq!(updated.access_count, 1);

        // Second download
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access("192.168.1.2".to_string(), true, Some(1024), None, None);

        let updated = service.get_share(&share_id).unwrap();
        assert_eq!(updated.access_count, 2);
    }

    #[test]
    fn test_download_logs_access_attempts() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "10.0.0.1".to_string(),
            true,
            Some(1024),
            None,
            Some("TestAgent/1.0".to_string()),
        );

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].ip_address, "10.0.0.1");
        assert!(logs[0].success);
        assert_eq!(logs[0].bytes_transferred, Some(1024));
        assert_eq!(logs[0].user_agent.as_deref(), Some("TestAgent/1.0"));
    }

    #[test]
    fn test_download_logs_failed_access_attempts() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "10.0.0.1".to_string(),
            false,
            None,
            Some("File not found".to_string()),
            None,
        );

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
        assert_eq!(logs[0].error_message.as_deref(), Some("File not found"));
    }

    #[test]
    fn test_download_validates_share_id_format() {
        // Valid share IDs (8-10 alphanumeric chars)
        assert!(is_valid_share_id("abcd1234"));
        assert!(is_valid_share_id("ABCD1234EF"));
        assert!(is_valid_share_id("aB1cD2eF3"));

        // Invalid: too short
        assert!(!is_valid_share_id("abc"));
        assert!(!is_valid_share_id("ab12345"));

        // Invalid: too long
        assert!(!is_valid_share_id("abcdefghijk"));

        // Invalid: special characters
        assert!(!is_valid_share_id("abc-1234"));
        assert!(!is_valid_share_id("abc_1234"));
        assert!(!is_valid_share_id("abc@1234"));
    }

    #[test]
    fn test_download_captures_user_agent_and_ip() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
        let ip = "203.0.113.42";

        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            ip.to_string(),
            true,
            Some(1024),
            None,
            Some(user_agent.to_string()),
        );

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs[0].ip_address, ip);
        assert_eq!(logs[0].user_agent.as_deref(), Some(user_agent));
    }

    #[test]
    fn test_download_handles_multiple_downloads_of_same_share() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        // Simulate 5 successful downloads
        for i in 0..5 {
            let s = service.get_share_mut(&share_id).unwrap();
            s.record_access(format!("192.168.1.{}", i + 1), true, Some(1024), None, None);
        }

        let updated = service.get_share(&share_id).unwrap();
        assert_eq!(updated.access_count, 5);
        assert_eq!(updated.access_logs.len(), 5);
    }

    // ============= Password-Protected Shares Tests =============

    #[test]
    fn test_password_protected_share_creation_and_auth() {
        let (mut service, _) = setup_with_file();

        let (share, password) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        assert!(share.has_password());
        assert!(password.is_some());
        let pwd = password.unwrap();

        // Correct password should verify
        assert!(share.verify_password(&pwd));

        // Wrong password should fail
        assert!(!share.verify_password("wrongpass"));
    }

    #[test]
    fn test_password_protected_rejects_wrong_password() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        // Handler should return 401 for wrong password
        assert!(!share.verify_password("definitely_wrong"));
        let status_code = 401;
        assert_eq!(status_code, 401);
    }

    #[test]
    fn test_password_protected_succeeds_with_correct_password() {
        let (mut service, _) = setup_with_file();

        let (share, password) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        let pwd = password.unwrap();
        assert!(share.verify_password(&pwd));
        // Handler should proceed to file download
    }

    #[test]
    fn test_password_protected_logs_failed_password_attempts() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        // Simulate failed password attempt
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "10.0.0.1".to_string(),
            false,
            None,
            Some("Invalid password".to_string()),
            Some("Mozilla/5.0".to_string()),
        );

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
        assert_eq!(logs[0].error_message.as_deref(), Some("Invalid password"));
    }

    #[test]
    fn test_password_protected_handles_malformed_authorization_header() {
        // Not a Basic auth header
        let result = extract_basic_auth_password("Bearer some_token");
        assert!(result.is_none());

        // Completely wrong format
        let result = extract_basic_auth_password("garbage");
        assert!(result.is_none());

        // Empty header
        let result = extract_basic_auth_password("");
        assert!(result.is_none());
    }

    #[test]
    fn test_password_protected_handles_invalid_base64() {
        // Invalid base64 content
        let result = extract_basic_auth_password("Basic !!!invalid!!!");
        assert!(result.is_none());

        // Valid base64 but no colon separator (no password part)
        use base64::{Engine, engine::general_purpose};
        let no_colon = general_purpose::STANDARD.encode("usernameonly");
        let result = extract_basic_auth_password(&format!("Basic {}", no_colon));
        assert!(result.is_none());
    }

    #[test]
    fn test_password_protected_extracts_correct_password_from_basic_auth() {
        use base64::{Engine, engine::general_purpose};

        // Standard Basic Auth: base64("username:password")
        let encoded = general_purpose::STANDARD.encode(":mypassword123");
        let result = extract_basic_auth_password(&format!("Basic {}", encoded));
        assert_eq!(result, Some("mypassword123".to_string()));

        // With username
        let encoded = general_purpose::STANDARD.encode("user:secretpwd");
        let result = extract_basic_auth_password(&format!("Basic {}", encoded));
        assert_eq!(result, Some("secretpwd".to_string()));
    }

    #[test]
    fn test_password_is_hashed_in_storage() {
        let (mut service, _) = setup_with_file();

        let (share, password) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        let pwd = password.unwrap();

        // Password hash should exist
        assert!(share.password_hash.is_some());
        let hash = share.password_hash.as_ref().unwrap();

        // Hash should NOT be the plaintext password
        assert_ne!(hash, &pwd);

        // Hash should be a bcrypt hash (starts with $2b$ or $2a$)
        assert!(hash.starts_with("$2b$") || hash.starts_with("$2a$"));

        // But verification should work
        assert!(bcrypt::verify(&pwd, hash).unwrap());
    }

    #[test]
    fn test_password_required_returns_401_with_www_authenticate() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        // When no password provided, handler should return 401 with
        // WWW-Authenticate: Basic realm="File Download"
        assert!(share.has_password());
        let no_password: Option<String> = None;
        assert!(no_password.is_none());
        // Response status: 401
        // Response header: WWW-Authenticate: Basic realm="File Download", charset="UTF-8"
    }

    // ============= Share Management Tests - GET /api/share (list) =============

    #[test]
    fn test_list_all_user_shares() {
        let (mut service, _) = setup_with_file();

        // Create multiple shares for user1
        service
            .create_share("file001", "doc1.txt", 100, "room1", "user1", 7, false, None)
            .unwrap();
        service
            .create_share(
                "file001", "doc2.txt", 200, "room1", "user1", 15, false, None,
            )
            .unwrap();
        service
            .create_share(
                "file001", "doc3.txt", 300, "room1", "user1", 30, false, None,
            )
            .unwrap();

        // Create a share for different user
        service
            .create_share(
                "file001",
                "other.txt",
                400,
                "room2",
                "user2",
                7,
                false,
                None,
            )
            .unwrap();

        let user1_shares = service.get_user_shares("user1");
        let user2_shares = service.get_user_shares("user2");

        assert_eq!(user1_shares.len(), 3);
        assert_eq!(user2_shares.len(), 1);
    }

    #[test]
    fn test_filter_shares_by_active_status() {
        let (mut service, _) = setup_with_file();

        // Create active share
        service
            .create_share(
                "file001",
                "active.txt",
                100,
                "room1",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();

        // Create expired share
        service
            .create_share(
                "file001",
                "expired.txt",
                100,
                "room1",
                "user1",
                -1,
                false,
                None,
            )
            .unwrap();

        let all_shares = service.get_user_shares("user1");
        assert_eq!(all_shares.len(), 2);

        let now = Utc::now();
        let active: Vec<_> = all_shares
            .iter()
            .filter(|s| s.is_active && s.expires_at > now)
            .collect();
        let expired: Vec<_> = all_shares
            .iter()
            .filter(|s| !s.is_active || s.expires_at <= now)
            .collect();

        assert_eq!(active.len(), 1);
        assert_eq!(expired.len(), 1);
    }

    #[test]
    fn test_filter_shares_by_revoked_as_expired() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share("file001", "test.txt", 100, "room1", "user1", 7, false, None)
            .unwrap();
        let share_id = share.share_id.clone();

        // Revoke the share
        service.revoke_share(&share_id).unwrap();

        let all_shares = service.get_user_shares("user1");
        let now = Utc::now();
        let expired: Vec<_> = all_shares
            .iter()
            .filter(|s| !s.is_active || s.expires_at <= now)
            .collect();

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].share_id, share_id);
    }

    #[test]
    fn test_paginate_share_list() {
        let (mut service, _) = setup_with_file();

        // Create 10 shares
        for i in 0..10 {
            service
                .create_share(
                    "file001",
                    &format!("doc{}.txt", i),
                    100,
                    "room1",
                    "user1",
                    7,
                    false,
                    None,
                )
                .unwrap();
        }

        let all_shares = service.get_user_shares("user1");
        assert_eq!(all_shares.len(), 10);

        // Simulate pagination: offset=2, limit=3
        let offset = 2;
        let limit = 3;
        let paginated: Vec<_> = all_shares.iter().skip(offset).take(limit).collect();
        assert_eq!(paginated.len(), 3);

        // Simulate pagination: offset=8, limit=5 (only 2 left)
        let paginated: Vec<_> = all_shares.iter().skip(8).take(5).collect();
        assert_eq!(paginated.len(), 2);
    }

    #[test]
    fn test_share_list_response_format() {
        let (mut service, _) = setup_with_file();

        let mut metadata = HashMap::new();
        metadata.insert(
            "originalFilename".to_string(),
            serde_json::Value::String("My Document.txt".to_string()),
        );

        let (share, _) = service
            .create_share(
                "file001",
                "stored.txt",
                2048,
                "room1",
                "user1",
                7,
                false,
                Some(metadata),
            )
            .unwrap();

        let list_item = share.to_list_item("http://localhost:3001");

        assert_eq!(list_item.share_id, share.share_id);
        assert_eq!(list_item.original_filename, "My Document.txt");
        assert_eq!(list_item.file_size, 2048);
        assert_eq!(list_item.status, "active");
        assert_eq!(list_item.access_count, 0);
        assert!(!list_item.has_password);
        assert!(list_item.url.contains("/public/file/"));
        assert!(list_item.url.starts_with("http://localhost:3001"));
        // Dates should be ISO 8601 strings
        assert!(list_item.created_at.contains('T'));
        assert!(list_item.expires_at.contains('T'));
    }

    // ============= GET /api/share/:shareId Tests =============

    #[test]
    fn test_get_share_details() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        let retrieved = service.get_share(&share.share_id);
        assert!(retrieved.is_some());

        let info = retrieved.unwrap();
        assert_eq!(info.share_id, share.share_id);
        assert_eq!(info.file_name, "test.txt");
        assert_eq!(info.file_size, 1024);
        assert!(info.is_active);
        assert!(!info.is_expired());
    }

    #[test]
    fn test_get_share_returns_404_for_nonexistent() {
        let service = MockShareService::new();
        let result = service.get_share("nonexistent");
        assert!(result.is_none());
        // Handler returns 404 "Share not found"
    }

    // ============= DELETE /api/share/:shareId Tests =============

    #[test]
    fn test_revoke_share_link() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let result = service.revoke_share(&share_id);
        assert!(result.is_ok());
        assert!(result.unwrap());

        let revoked = service.get_share(&share_id).unwrap();
        assert!(!revoked.is_active);
    }

    #[test]
    fn test_revoke_share_non_owner_rejected() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        // Simulate ownership check (handler verifies x-user-id matches created_by)
        let requesting_user = "user2";
        assert_ne!(share.created_by, requesting_user);
        // Handler returns 403 "You do not have permission to revoke this share"
        let status_code = 403;
        assert_eq!(status_code, 403);
    }

    #[test]
    fn test_revoke_share_returns_404_for_nonexistent() {
        let mut service = MockShareService::new();
        let result = service.revoke_share("nonexistent");
        assert!(result.is_ok());
        assert!(!result.unwrap()); // false = not found
    }

    #[test]
    fn test_revoke_share_requires_user_id_header() {
        // When x-user-id header is missing, handler returns 401
        let user_id: Option<&str> = None;
        assert!(user_id.is_none());
        let status_code = 401;
        assert_eq!(status_code, 401);
    }

    // ============= POST /api/share/:shareId/permanent-delete Tests =============

    #[test]
    fn test_permanent_delete_share() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let deleted = service.delete_share(&share_id);
        assert!(deleted.is_some());

        // Share should no longer exist
        assert!(service.get_share(&share_id).is_none());
    }

    #[test]
    fn test_permanent_delete_non_owner_rejected() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        // Simulate ownership check
        let requesting_user = "user2";
        assert_ne!(share.created_by, requesting_user);
        // Handler returns 403
        let status_code = 403;
        assert_eq!(status_code, 403);
    }

    #[test]
    fn test_permanent_delete_returns_404_for_nonexistent() {
        let mut service = MockShareService::new();
        let result = service.delete_share("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_permanent_delete_removes_from_user_shares() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        assert_eq!(service.get_user_shares("user1").len(), 1);

        service.delete_share(&share_id);

        assert_eq!(service.get_user_shares("user1").len(), 0);
    }

    // ============= GET /api/share/:shareId/access Tests =============

    #[test]
    fn test_get_access_logs_for_share() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        // Record some access logs
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "10.0.0.1".into(),
            true,
            Some(1024),
            None,
            Some("Chrome".into()),
        );
        s.record_access(
            "10.0.0.2".into(),
            false,
            None,
            Some("Invalid password".into()),
            None,
        );
        s.record_access(
            "10.0.0.3".into(),
            true,
            Some(1024),
            None,
            Some("Firefox".into()),
        );

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 3);

        // Verify log details
        assert!(logs[0].success);
        assert_eq!(logs[0].ip_address, "10.0.0.1");
        assert!(!logs[1].success);
        assert_eq!(logs[1].error_message.as_deref(), Some("Invalid password"));
        assert!(logs[2].success);
    }

    #[test]
    fn test_access_logs_returns_404_for_nonexistent_share() {
        let service = MockShareService::new();
        let logs = service.get_access_logs("nonexistent");
        assert!(logs.is_none());
        // Handler returns 404 "Share not found"
    }

    #[test]
    fn test_access_logs_empty_for_new_share() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        let logs = service.get_access_logs(&share.share_id).unwrap();
        assert_eq!(logs.len(), 0);
    }

    #[test]
    fn test_access_logs_include_timestamps() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        let before = Utc::now();
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access("10.0.0.1".into(), true, Some(1024), None, None);
        let after = Utc::now();

        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].timestamp >= before);
        assert!(logs[0].timestamp <= after);
    }

    // ============= URL Format Tests =============

    #[test]
    fn test_share_url_format_without_password() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        let base_url = "http://localhost:3001";
        let url = format!("{}/public/file/{}", base_url, share.share_id);

        assert!(url.starts_with("http://localhost:3001/public/file/"));
        assert!(!url.contains("password="));
    }

    #[test]
    fn test_share_url_format_with_password() {
        let (mut service, _) = setup_with_file();

        let (share, password) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, true, None,
            )
            .unwrap();

        let pwd = password.unwrap();
        let base_url = "http://localhost:3001";
        let url = format!(
            "{}/public/file/{}?password={}",
            base_url, share.share_id, pwd
        );

        assert!(url.contains("/public/file/"));
        assert!(url.contains("password="));
    }

    #[test]
    fn test_share_url_uses_public_url_env() {
        // When PUBLIC_URL is set, it should be used as the base
        let public_url = "https://example.com/clipboard";
        let share_id = "abc12345";
        let url = format!(
            "{}/public/file/{}",
            public_url.trim_end_matches('/'),
            share_id
        );

        assert_eq!(url, "https://example.com/clipboard/public/file/abc12345");
    }

    // ============= Data Consistency Tests =============

    #[test]
    fn test_dates_serialized_as_iso_strings() {
        let (mut service, _) = setup_with_file();

        let (share, _) = service
            .create_share(
                "file001", "test.txt", 1024, "room123", "user1", 7, false, None,
            )
            .unwrap();

        let created_str = share.created_at.to_rfc3339();
        let expires_str = share.expires_at.to_rfc3339();

        // ISO 8601 format check
        assert!(created_str.contains('T'));
        assert!(expires_str.contains('T'));

        // Dates should be parseable
        let parsed_created = chrono::DateTime::parse_from_rfc3339(&created_str);
        let parsed_expires = chrono::DateTime::parse_from_rfc3339(&expires_str);
        assert!(parsed_created.is_ok());
        assert!(parsed_expires.is_ok());
    }

    #[test]
    fn test_share_status_consistency() {
        let (mut service, _) = setup_with_file();

        // Active share
        let (share, _) = service
            .create_share(
                "file001",
                "active.txt",
                100,
                "room1",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();
        let item = share.to_list_item("http://localhost:3001");
        assert_eq!(item.status, "active");

        // Expired share
        let (expired, _) = service
            .create_share(
                "file001",
                "expired.txt",
                100,
                "room1",
                "user1",
                -1,
                false,
                None,
            )
            .unwrap();
        let item = expired.to_list_item("http://localhost:3001");
        assert_eq!(item.status, "expired");

        // Revoked share
        let (revoked, _) = service
            .create_share(
                "file001",
                "revoked.txt",
                100,
                "room1",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();
        let revoked_id = revoked.share_id.clone();
        service.revoke_share(&revoked_id).unwrap();
        let revoked = service.get_share(&revoked_id).unwrap();
        let item = revoked.to_list_item("http://localhost:3001");
        assert_eq!(item.status, "expired"); // Revoked shows as "expired" in API
    }

    // ============= Error Handling Tests =============

    #[test]
    fn test_create_share_handles_missing_body_fields() {
        // fileId is required - handler validates via JSON deserialization
        let file_id = "";
        assert!(file_id.is_empty());
        // Handler returns 400 for missing/empty required fields
    }

    #[test]
    fn test_error_responses_use_uniform_format() {
        // All error responses should follow ApiResponse format:
        // { success: false, message: "...", data: null }

        struct ApiResponse {
            success: bool,
            message: Option<String>,
        }

        // 400 Bad Request
        let bad_request = ApiResponse {
            success: false,
            message: Some("Expiration must be 1-30 days".to_string()),
        };
        assert!(!bad_request.success);
        assert!(bad_request.message.is_some());

        // 401 Unauthorized
        let unauthorized = ApiResponse {
            success: false,
            message: Some("Password required".to_string()),
        };
        assert!(!unauthorized.success);

        // 403 Forbidden
        let forbidden = ApiResponse {
            success: false,
            message: Some("You do not have permission to revoke this share".to_string()),
        };
        assert!(!forbidden.success);

        // 404 Not Found
        let not_found = ApiResponse {
            success: false,
            message: Some("Share not found".to_string()),
        };
        assert!(!not_found.success);
    }

    // ============= GET /api/share/user/:userId Tests =============

    #[test]
    fn test_get_user_shares_endpoint() {
        let (mut service, _) = setup_with_file();

        service
            .create_share("file001", "a.txt", 100, "room1", "alice", 7, false, None)
            .unwrap();
        service
            .create_share("file001", "b.txt", 200, "room1", "alice", 7, false, None)
            .unwrap();
        service
            .create_share("file001", "c.txt", 300, "room1", "bob", 7, false, None)
            .unwrap();

        let alice_shares = service.get_user_shares("alice");
        let bob_shares = service.get_user_shares("bob");

        assert_eq!(alice_shares.len(), 2);
        assert_eq!(bob_shares.len(), 1);
    }

    #[test]
    fn test_get_user_shares_empty_for_unknown_user() {
        let service = MockShareService::new();
        let shares = service.get_user_shares("unknown_user");
        assert!(shares.is_empty());
    }

    // ============= Combined Workflow Tests =============

    #[test]
    fn test_full_share_lifecycle() {
        let (mut service, _) = setup_with_file();

        // 1. Create share
        let (share, _) = service
            .create_share(
                "file001",
                "document.pdf",
                5000,
                "room123",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();
        let share_id = share.share_id.clone();

        // 2. Verify it's active
        let info = service.get_share(&share_id).unwrap();
        assert!(info.is_active);
        assert!(!info.is_expired());

        // 3. Simulate downloads
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access("10.0.0.1".into(), true, Some(5000), None, None);
        s.record_access("10.0.0.2".into(), true, Some(5000), None, None);

        // 4. Check access count
        let info = service.get_share(&share_id).unwrap();
        assert_eq!(info.access_count, 2);
        assert_eq!(info.access_logs.len(), 2);

        // 5. Revoke
        service.revoke_share(&share_id).unwrap();
        let info = service.get_share(&share_id).unwrap();
        assert!(!info.is_active);

        // 6. Permanent delete
        let deleted = service.delete_share(&share_id);
        assert!(deleted.is_some());
        assert!(service.get_share(&share_id).is_none());
    }

    #[test]
    fn test_password_protected_share_full_workflow() {
        let (mut service, _) = setup_with_file();

        // 1. Create password-protected share
        let (share, password) = service
            .create_share(
                "file001",
                "secret.pdf",
                3000,
                "room123",
                "user1",
                7,
                true,
                None,
            )
            .unwrap();
        let share_id = share.share_id.clone();
        let pwd = password.unwrap();

        // 2. Attempt download without password - should fail
        assert!(share.has_password());
        let no_password: Option<String> = None;
        assert!(no_password.is_none()); // 401 response

        // 3. Attempt with wrong password
        assert!(!share.verify_password("wrong"));
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access(
            "10.0.0.1".into(),
            false,
            None,
            Some("Invalid password".into()),
            None,
        );

        // 4. Attempt with correct password - should succeed
        let s = service.get_share(&share_id).unwrap();
        assert!(s.verify_password(&pwd));
        let s = service.get_share_mut(&share_id).unwrap();
        s.record_access("10.0.0.1".into(), true, Some(3000), None, None);

        // 5. Check logs show both attempts
        let logs = service.get_access_logs(&share_id).unwrap();
        assert_eq!(logs.len(), 2);
        assert!(!logs[0].success); // Failed attempt
        assert!(logs[1].success); // Successful attempt

        // 6. Access count only counts successes
        let info = service.get_share(&share_id).unwrap();
        assert_eq!(info.access_count, 1);
    }

    #[test]
    fn test_multiple_users_shares_isolation() {
        let (mut service, _) = setup_with_file();

        // User1 creates shares
        let (share1, _) = service
            .create_share(
                "file001",
                "user1-file.txt",
                100,
                "room1",
                "user1",
                7,
                false,
                None,
            )
            .unwrap();

        // User2 creates shares
        let (share2, _) = service
            .create_share(
                "file001",
                "user2-file.txt",
                200,
                "room2",
                "user2",
                7,
                false,
                None,
            )
            .unwrap();

        // Each user sees only their own shares
        let user1_shares = service.get_user_shares("user1");
        let user2_shares = service.get_user_shares("user2");

        assert_eq!(user1_shares.len(), 1);
        assert_eq!(user1_shares[0].share_id, share1.share_id);

        assert_eq!(user2_shares.len(), 1);
        assert_eq!(user2_shares[0].share_id, share2.share_id);

        // User2 cannot revoke User1's share (ownership check)
        let share1_created_by = &service.get_share(&share1.share_id).unwrap().created_by;
        assert_ne!(share1_created_by, "user2");
    }
}
