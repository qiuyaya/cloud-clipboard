/// ShareService Extended Tests
///
/// Concurrent, batch, and edge case tests that complement the inline unit tests.
/// All tests use the real production ShareService.
#[cfg(test)]
mod tests {
    use cloud_clipboard_server::services::{CreateShareRequest, ShareService};
    use std::sync::Arc;
    use std::thread;

    fn create_service() -> ShareService {
        ShareService::new()
    }

    fn create_share_simple(service: &ShareService, file_name: &str, user: &str) -> String {
        let (share, _) = service
            .create_share(CreateShareRequest::new(
                file_name, file_name, 100, "room1", user,
            ))
            .unwrap();
        share.share_id
    }

    // ===== Concurrent tests =====

    #[test]
    fn test_concurrent_share_creation() {
        let service = Arc::new(create_service());
        let mut handles = vec![];

        for i in 0..10 {
            let svc = Arc::clone(&service);
            let handle = thread::spawn(move || {
                svc.create_share(CreateShareRequest::new(
                    format!("file{}.txt", i),
                    format!("file{}.txt", i),
                    100,
                    "room1",
                    "user1",
                ))
            });
            handles.push(handle);
        }

        let mut successes = 0;
        for h in handles {
            if h.join().unwrap().is_ok() {
                successes += 1;
            }
        }
        assert_eq!(successes, 10);

        let shares = service.get_user_shares("user1");
        assert_eq!(shares.len(), 10);
    }

    #[test]
    fn test_concurrent_share_access() {
        let service = Arc::new(create_service());
        let share_id = create_share_simple(&service, "test.txt", "user1");

        let mut handles = vec![];
        for i in 0..50 {
            let svc = Arc::clone(&service);
            let id = share_id.clone();
            let handle = thread::spawn(move || {
                svc.record_access(
                    &id,
                    format!("192.168.1.{}", i % 255),
                    true,
                    Some(1024),
                    None,
                    Some("Test".into()),
                )
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap().unwrap();
        }

        let updated = service.get_share(&share_id).unwrap();
        assert_eq!(updated.access_count, 50);
    }

    #[test]
    fn test_concurrent_revoke() {
        let service = Arc::new(create_service());
        let mut share_ids = vec![];
        for i in 0..5 {
            share_ids.push(create_share_simple(
                &service,
                &format!("file{}.txt", i),
                "user1",
            ));
        }

        let mut handles = vec![];
        for id in share_ids.clone() {
            let svc = Arc::clone(&service);
            handles.push(thread::spawn(move || svc.revoke_share(&id)));
        }

        for handle in handles {
            assert!(handle.join().unwrap().is_ok());
        }

        for id in &share_ids {
            assert!(!service.get_share(id).unwrap().is_active);
        }
    }

    #[test]
    fn test_create_and_access_race() {
        use std::sync::mpsc;

        let service = Arc::new(create_service());
        let (tx, rx) = mpsc::channel();

        let svc1 = Arc::clone(&service);
        let h1 = thread::spawn(move || {
            let (share, _) = svc1
                .create_share(CreateShareRequest::new(
                    "test.txt", "test.txt", 100, "room1", "user1",
                ))
                .unwrap();
            tx.send(share.share_id).unwrap();
        });

        let svc2 = Arc::clone(&service);
        let h2 = thread::spawn(move || {
            if let Ok(share_id) = rx.recv() {
                svc2.record_access(
                    &share_id,
                    "192.168.1.1".into(),
                    true,
                    Some(1024),
                    None,
                    None,
                )
                .unwrap();
            }
        });

        h1.join().unwrap();
        h2.join().unwrap();
    }

    // ===== Batch tests =====

    #[test]
    fn test_batch_share_creation_and_deletion() {
        let service = create_service();
        let mut ids = vec![];
        for i in 0..20 {
            ids.push(create_share_simple(
                &service,
                &format!("file{}.txt", i),
                "user1",
            ));
        }
        assert_eq!(service.get_user_shares("user1").len(), 20);

        for id in &ids {
            service.delete_share(id).unwrap();
        }
        assert_eq!(service.get_user_shares("user1").len(), 0);
    }

    #[test]
    fn test_batch_expire_cleanup() {
        let service = create_service();

        // Create 3 expired shares
        for i in 0..3 {
            service
                .create_share(
                    CreateShareRequest::new(
                        format!("expired{}.txt", i),
                        format!("expired{}.txt", i),
                        100,
                        "room1",
                        "user1",
                    )
                    .with_expiration(-1),
                )
                .unwrap();
        }

        // Create 3 active shares
        for i in 0..3 {
            service
                .create_share(CreateShareRequest::new(
                    format!("active{}.txt", i),
                    format!("active{}.txt", i),
                    100,
                    "room1",
                    "user1",
                ))
                .unwrap();
        }

        let expired = service.cleanup_expired_shares();
        assert_eq!(expired.len(), 3);
        assert_eq!(service.get_user_shares("user1").len(), 3);
    }

    // ===== Access log tests =====

    #[test]
    fn test_access_log_mixed_success_failure() {
        let service = create_service();
        let share_id = create_share_simple(&service, "test.txt", "user1");

        service
            .record_access(&share_id, "1.1.1.1".into(), true, Some(1024), None, None)
            .unwrap();
        service
            .record_access(
                &share_id,
                "2.2.2.2".into(),
                false,
                None,
                Some("bad_pw".into()),
                None,
            )
            .unwrap();

        let logs = service.get_access_logs(&share_id);
        assert_eq!(logs.len(), 2);
        assert_eq!(logs.iter().filter(|l| l.success).count(), 1);
        assert_eq!(logs.iter().filter(|l| !l.success).count(), 1);
    }

    #[test]
    fn test_access_count_accumulates() {
        let service = create_service();
        let share_id = create_share_simple(&service, "test.txt", "user1");

        for i in 0..15 {
            service
                .record_access(
                    &share_id,
                    format!("192.168.1.{}", i % 5),
                    true,
                    Some(1024 * (i as u64 + 1)),
                    None,
                    None,
                )
                .unwrap();
        }

        let share = service.get_share(&share_id).unwrap();
        assert_eq!(share.access_count, 15);
    }

    // ===== Edge case tests =====

    #[test]
    fn test_multiple_users_same_filename() {
        let service = create_service();
        let id1 = create_share_simple(&service, "test.txt", "user1");
        let id2 = create_share_simple(&service, "test.txt", "user2");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_expiration_zero_days() {
        let service = create_service();
        let (share, _) = service
            .create_share(
                CreateShareRequest::new("test.txt", "test.txt", 100, "room1", "user1")
                    .with_expiration(0),
            )
            .unwrap();

        std::thread::sleep(std::time::Duration::from_millis(10));
        let retrieved = service.get_share(&share.share_id).unwrap();
        assert!(!retrieved.is_active || retrieved.expires_at <= chrono::Utc::now());
    }

    #[test]
    fn test_password_hash_uniqueness() {
        let service = create_service();

        let (_share1, pwd1) = service
            .create_share(
                CreateShareRequest::new("f1.txt", "f1.txt", 100, "room1", "user1")
                    .with_auto_password(),
            )
            .unwrap();

        let (_share2, pwd2) = service
            .create_share(
                CreateShareRequest::new("f2.txt", "f2.txt", 100, "room1", "user1")
                    .with_auto_password(),
            )
            .unwrap();

        // Different auto-generated passwords
        assert_ne!(pwd1, pwd2);
    }
}
