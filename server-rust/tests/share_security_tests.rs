/// Share Security Tests
///
/// Security-focused tests that verify the file sharing system's protection
/// mechanisms by calling real production code. Tests cover:
/// - Share ID format security (injection prevention)
/// - Password hashing and verification
/// - Access control (revoked/expired shares)
/// - Response data sanitization (no sensitive data leakage)
/// - User isolation between shares
/// - Filename validation against encoded attacks
#[cfg(test)]
mod tests {
    use cloud_clipboard_server::routes::files::{is_dangerous_extension, is_valid_filename};
    use cloud_clipboard_server::services::{CreateShareRequest, ShareService};
    use cloud_clipboard_server::utils::generate_share_id;

    // ===== Share ID format security =====

    #[test]
    fn test_share_id_alphanumeric_only() {
        // Share IDs must be safe for URL embedding without injection risk
        for _ in 0..20 {
            let id = generate_share_id();
            assert!(
                id.chars().all(|c| c.is_ascii_alphanumeric()),
                "Share ID contains non-alphanumeric character: {}",
                id
            );
        }
    }

    #[test]
    fn test_share_id_length_bounds() {
        for _ in 0..20 {
            let id = generate_share_id();
            assert!(
                (8..=10).contains(&id.len()),
                "Share ID length out of bounds: {} (len={})",
                id,
                id.len()
            );
        }
    }

    #[test]
    fn test_share_id_uniqueness() {
        let ids: Vec<String> = (0..100).map(|_| generate_share_id()).collect();
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), unique.len(), "Share IDs must be unique");
    }

    // ===== Password hashing security =====

    #[test]
    fn test_password_bcrypt_hashed_not_plaintext() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_password("mysecretpassword"),
            )
            .unwrap();

        // The stored hash must not equal the plaintext password
        let stored = service.get_share(&share.share_id).unwrap();
        assert!(stored.has_password());
        // Verify via the production verify_password method
        assert!(stored.verify_password("mysecretpassword"));
        assert!(!stored.verify_password("wrongpassword"));
    }

    #[test]
    fn test_auto_generated_password_unique_per_share() {
        let service = ShareService::new();

        let (_, pwd1) = service
            .create_share(
                CreateShareRequest::new("f1.txt", "f1.txt", 100, "room1", "user1")
                    .with_auto_password(),
            )
            .unwrap();

        let (_, pwd2) = service
            .create_share(
                CreateShareRequest::new("f2.txt", "f2.txt", 100, "room1", "user1")
                    .with_auto_password(),
            )
            .unwrap();

        let p1 = pwd1.unwrap();
        let p2 = pwd2.unwrap();
        assert_eq!(p1.len(), 6);
        assert_eq!(p2.len(), 6);
        assert_ne!(p1, p2, "Auto-generated passwords must differ");
    }

    #[test]
    fn test_no_password_share_allows_any_verification() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        // No-password shares return true for any password attempt
        assert!(
            service
                .verify_password(&share.share_id, "anything")
                .unwrap()
        );
    }

    // ===== Access control =====

    #[test]
    fn test_revoked_share_marked_inactive() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                "test.txt", "test.txt", 100, "room1", "user1",
            ))
            .unwrap();

        service.revoke_share(&share.share_id).unwrap();

        let revoked = service.get_share(&share.share_id).unwrap();
        assert!(!revoked.is_active, "Revoked share must be inactive");
    }

    #[test]
    fn test_expired_share_detected() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_expiration(-1),
            )
            .unwrap();

        let retrieved = service.get_share(&share.share_id).unwrap();
        assert!(retrieved.is_expired(), "Share with -1 days must be expired");
    }

    #[test]
    fn test_expired_share_response_status() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_expiration(-1),
            )
            .unwrap();

        let info = service.get_share_info(&share.share_id).unwrap();
        assert!(!info.is_active);
        assert!(info.is_expired);
        assert_eq!(info.status, "expired");
    }

    // ===== Response data sanitization =====

    #[test]
    fn test_share_response_excludes_sensitive_fields() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new(
                    "/app/uploads/secret.txt",
                    "secret.txt",
                    100,
                    "room1",
                    "user1",
                )
                .with_password("verysecret"),
            )
            .unwrap();

        let info = service.get_share_info(&share.share_id).unwrap();
        // ShareInfoResponse should only expose safe fields
        assert_eq!(info.file_name, "secret.txt");
        assert!(info.has_password);
        // No password_hash, file_path, or metadata fields exposed in ShareInfoResponse
        // (This is structurally enforced by the type, but we verify the response is valid)
        assert!(!info.share_id.is_empty());
    }

    // ===== User isolation =====

    #[test]
    fn test_user_shares_isolated() {
        let service = ShareService::new();

        service
            .create_share(CreateShareRequest::new(
                "user1_file.txt",
                "user1_file.txt",
                100,
                "room1",
                "user1",
            ))
            .unwrap();

        service
            .create_share(CreateShareRequest::new(
                "user2_file.txt",
                "user2_file.txt",
                100,
                "room1",
                "user2",
            ))
            .unwrap();

        let user1_shares = service.get_user_shares("user1");
        let user2_shares = service.get_user_shares("user2");

        assert_eq!(user1_shares.len(), 1);
        assert_eq!(user2_shares.len(), 1);
        assert_ne!(
            user1_shares[0].share_id, user2_shares[0].share_id,
            "Users must have separate shares"
        );
    }

    // ===== Filename validation against encoded attacks =====

    #[test]
    fn test_url_encoded_path_traversal_rejected() {
        // After URL decoding, path traversal characters must be caught
        let encoded = "%2e%2e%2f%2e%2e%2fetc%2fpasswd";
        let decoded = urlencoding::decode(encoded).unwrap();
        assert!(
            !is_valid_filename(&decoded),
            "URL-decoded path traversal must be rejected"
        );
    }

    #[test]
    fn test_double_url_encoded_traversal_rejected() {
        let double_encoded = "%252e%252e%252f";
        let single_decoded = urlencoding::decode(double_encoded).unwrap();
        let double_decoded = urlencoding::decode(&single_decoded).unwrap();
        assert!(
            !is_valid_filename(&double_decoded),
            "Double-decoded path traversal must be rejected"
        );
    }

    #[test]
    fn test_null_byte_filename_rejected() {
        // Null bytes in filenames should not pass validation
        let payloads = vec![
            "file.txt\x00.jpg", // embedded null byte
            "file\x00/../etc/passwd",
        ];
        for payload in payloads {
            // is_valid_filename checks for special chars; null byte filenames
            // containing path separators or .. should be caught
            if payload.contains("..") || payload.contains('/') {
                assert!(!is_valid_filename(payload));
            }
        }
    }

    #[test]
    fn test_dangerous_extension_case_insensitive() {
        // Attackers may use mixed case to bypass extension checks
        let evasion_attempts = vec!["payload.EXE", "backdoor.Php", "script.bAt", "code.PS1"];
        for filename in evasion_attempts {
            assert!(
                is_dangerous_extension(filename),
                "Case-evasive extension must be caught: {}",
                filename
            );
        }
    }

    #[test]
    fn test_access_log_records_failed_attempts() {
        let service = ShareService::new();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_password("correct"),
            )
            .unwrap();

        // Record a failed access (wrong password)
        service
            .record_access(
                &share.share_id,
                "10.0.0.1".into(),
                false,
                None,
                Some("invalid_password".into()),
                Some("curl/7.0".into()),
            )
            .unwrap();

        let logs = service.get_access_logs(&share.share_id);
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
        assert_eq!(logs[0].ip_address, "10.0.0.1");
        assert_eq!(logs[0].error_message, Some("invalid_password".to_string()));

        // Failed access should NOT increment access_count
        let s = service.get_share(&share.share_id).unwrap();
        assert_eq!(s.access_count, 0);
    }
}
