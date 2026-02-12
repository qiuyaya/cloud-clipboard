/// Integration Tests
///
/// These tests verify cross-service integration by exercising multiple
/// services together in realistic scenarios.
#[cfg(test)]
mod tests {
    use chrono::Utc;
    use cloud_clipboard_server::models::{
        Message,
        message::{FileInfo, MessageSender, MessageType},
    };
    use cloud_clipboard_server::services::{
        CreateShareRequest, FileManager, JoinRoomRequest, RoomService, ShareService,
    };
    use std::env;
    use std::sync::Arc;

    fn create_room_service() -> Arc<RoomService> {
        Arc::new(RoomService::new())
    }

    fn create_file_manager() -> FileManager {
        let test_dir = env::temp_dir().join(format!("test_integration_{}", uuid::Uuid::new_v4()));
        FileManager::new_with_config(test_dir, 10 * 1024 * 1024, 12).unwrap()
    }

    fn create_share_service() -> ShareService {
        ShareService::new()
    }

    // ===== Room + User integration =====

    #[test]
    fn test_full_room_lifecycle() {
        let service = create_room_service();

        // Create room and join user
        let (user, users) = service
            .join_room(
                JoinRoomRequest::new("room123", "user1", "Alice", "socket1")
                    .with_fingerprint("fp1"),
            )
            .unwrap();

        assert_eq!(user.username, "Alice");
        assert_eq!(users.len(), 1);
        assert!(service.room_exists("room123"));

        // Second user joins
        let (user2, users2) = service
            .join_room(
                JoinRoomRequest::new("room123", "user2", "Bob", "socket2")
                    .with_device_type("mobile")
                    .with_fingerprint("fp2"),
            )
            .unwrap();

        assert_eq!(user2.username, "Bob");
        assert_eq!(users2.len(), 2);

        // Add a message
        let message = Message {
            id: "msg1".to_string(),
            message_type: MessageType::Text,
            content: Some("Hello from Alice".to_string()),
            sender: MessageSender::from_user(&user),
            timestamp: Utc::now(),
            room_key: "room123".to_string(),
            file_id: None,
            file_info: None,
            download_url: None,
        };
        service.add_message("room123", message).unwrap();

        let messages = service.get_messages("room123");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, Some("Hello from Alice".to_string()));

        // First user goes offline
        let result = service.set_user_offline("socket1");
        assert!(result.is_some());

        // Room still exists (user2 is online)
        assert!(service.room_exists("room123"));

        // Second user leaves
        service.leave_room("socket2");

        // Room may be destroyed when all online users have left
        // The offline user (user1) does not keep the room alive after explicit leave by last online user
        let room_exists = service.room_exists("room123");
        if room_exists {
            let users = service.get_room_users("room123");
            assert_eq!(users.len(), 1);
            assert!(!users[0].is_online);
        }
    }

    #[test]
    fn test_room_with_password_full_flow() {
        let service = create_room_service();

        // Create room with password
        service.create_room("secretroom1", Some("pass123")).unwrap();

        // Try joining without password
        let result = service.join_room(
            JoinRoomRequest::new("secretroom1", "user1", "Alice", "socket1")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Password required");

        // Try joining with wrong password
        let result = service.join_room(
            JoinRoomRequest::new("secretroom1", "user1", "Alice", "socket1")
                .with_password("wrong")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Invalid password");

        // Join with correct password
        let result = service.join_room(
            JoinRoomRequest::new("secretroom1", "user1", "Alice", "socket1")
                .with_password("pass123")
                .with_fingerprint("fp1"),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_unique_username_enforcement() {
        let service = create_room_service();

        // First user joins
        let (user1, _) = service
            .join_room(
                JoinRoomRequest::new("room123", "user1", "Alice", "socket1")
                    .with_fingerprint("fp1"),
            )
            .unwrap();
        assert_eq!(user1.username, "Alice");

        // Second user with same name gets a modified name
        let (user2, _) = service
            .join_room(
                JoinRoomRequest::new("room123", "user2", "Alice", "socket2")
                    .with_fingerprint("fp2"),
            )
            .unwrap();
        assert_ne!(user2.username, "Alice");
        assert!(user2.username.starts_with("Alice_"));
    }

    // ===== File Manager integration =====

    #[tokio::test]
    async fn test_file_upload_and_download_flow() {
        let manager = create_file_manager();
        let content = b"Hello, this is test file content!";

        // Upload file
        let file_info = manager
            .save_file("room123", "test.txt", "text/plain", content)
            .await
            .unwrap();

        assert_eq!(file_info.original_name, "test.txt");
        assert_eq!(file_info.size, content.len() as u64);
        assert!(file_info.path.exists());

        // Retrieve file
        let retrieved = manager.get_file(&file_info.filename);
        assert!(retrieved.is_some());
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.original_name, "test.txt");
        assert_eq!(retrieved.room_key, "room123");

        // Verify physical file content
        let file_content = tokio::fs::read(&retrieved.path).await.unwrap();
        assert_eq!(file_content, content);

        // Delete file
        let deleted = manager.delete_file(&file_info.filename).await.unwrap();
        assert!(deleted.is_some());
        assert!(!file_info.path.exists());

        // Cleanup
        let _ = tokio::fs::remove_dir_all(manager.upload_dir()).await;
    }

    #[tokio::test]
    async fn test_room_file_cleanup_on_destroy() {
        let manager = create_file_manager();

        // Upload files to a room
        manager
            .save_file("room123", "file1.txt", "text/plain", b"content1")
            .await
            .unwrap();
        manager
            .save_file("room123", "file2.txt", "text/plain", b"content2")
            .await
            .unwrap();
        manager
            .save_file("room456", "file3.txt", "text/plain", b"content3")
            .await
            .unwrap();

        let stats = manager.get_stats();
        assert_eq!(stats.total_files, 3);

        // Delete room123's files (simulates room destruction)
        let deleted = manager.delete_room_files("room123");
        assert_eq!(deleted.len(), 2);

        // room456's file should remain
        let stats = manager.get_stats();
        assert_eq!(stats.total_files, 1);

        let _ = tokio::fs::remove_dir_all(manager.upload_dir()).await;
    }

    // ===== Share Service integration =====

    #[test]
    fn test_share_creation_and_access_flow() {
        let share_service = create_share_service();

        // Create a share with password
        let (share, password) = share_service
            .create_share(CreateShareRequest::new(
                "test-file-id",
                "report.pdf",
                1024,
                "room123",
                "user1",
            ))
            .unwrap();

        assert!(password.is_none());
        assert!(share.is_active);
        assert_eq!(share.access_count, 0);

        // Record successful access
        share_service
            .record_access(
                &share.share_id,
                "192.168.1.100".to_string(),
                true,
                Some(1024),
                None,
                Some("Mozilla/5.0".to_string()),
            )
            .unwrap();

        // Verify access was recorded
        let logs = share_service.get_access_logs(&share.share_id);
        assert_eq!(logs.len(), 1);
        assert!(logs[0].success);
        assert_eq!(logs[0].ip_address, "192.168.1.100");

        // Verify access count increased
        let updated_share = share_service.get_share(&share.share_id).unwrap();
        assert_eq!(updated_share.access_count, 1);
    }

    #[test]
    fn test_share_with_password_access_flow() {
        let share_service = create_share_service();

        // Create password-protected share
        let (share, password) = share_service
            .create_share(
                CreateShareRequest::new("file-id", "secret.pdf", 2048, "room123", "user1")
                    .with_password("mypassword"),
            )
            .unwrap();

        assert!(share.has_password());
        assert_eq!(password, Some("mypassword".to_string()));

        // Verify correct password
        assert!(
            share_service
                .verify_password(&share.share_id, "mypassword")
                .unwrap()
        );

        // Verify wrong password
        assert!(
            !share_service
                .verify_password(&share.share_id, "wrong")
                .unwrap()
        );

        // Record failed access (wrong password)
        share_service
            .record_access(
                &share.share_id,
                "10.0.0.1".to_string(),
                false,
                None,
                Some("Invalid password".to_string()),
                None,
            )
            .unwrap();

        let logs = share_service.get_access_logs(&share.share_id);
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].success);
    }

    #[test]
    fn test_user_share_management_flow() {
        let share_service = create_share_service();

        // User creates multiple shares
        let (share1, _) = share_service
            .create_share(CreateShareRequest::new(
                "file1", "doc1.pdf", 100, "room1", "user123",
            ))
            .unwrap();

        let (share2, _) = share_service
            .create_share(CreateShareRequest::new(
                "file2", "doc2.pdf", 200, "room1", "user123",
            ))
            .unwrap();

        // Another user creates a share
        share_service
            .create_share(CreateShareRequest::new(
                "file3",
                "doc3.pdf",
                300,
                "room1",
                "other_user",
            ))
            .unwrap();

        // Verify user can list their own shares
        let user_shares = share_service.get_user_shares("user123");
        assert_eq!(user_shares.len(), 2);

        // Revoke one share
        share_service.revoke_share(&share1.share_id).unwrap();
        let revoked = share_service.get_share(&share1.share_id).unwrap();
        assert!(!revoked.is_active);

        // Delete the other share
        share_service.delete_share(&share2.share_id).unwrap();
        assert!(share_service.get_share(&share2.share_id).is_none());

        // User should have only the revoked share left
        let remaining = share_service.get_user_shares("user123");
        assert_eq!(remaining.len(), 1);
        assert!(!remaining[0].is_active);
    }

    // ===== Cross-service integration =====

    #[tokio::test]
    async fn test_room_with_file_and_message() {
        let room_service = create_room_service();
        let file_manager = create_file_manager();

        // User joins room
        let (user, _) = room_service
            .join_room(
                JoinRoomRequest::new("room123", "user1", "Alice", "socket1")
                    .with_fingerprint("fp1"),
            )
            .unwrap();

        // Upload a file
        let file_info = file_manager
            .save_file(
                "room123",
                "document.pdf",
                "application/pdf",
                b"PDF content here",
            )
            .await
            .unwrap();

        // Send a file message
        let file_message = Message {
            id: "msg1".to_string(),
            message_type: MessageType::File,
            content: None,
            sender: MessageSender::from_user(&user),
            timestamp: Utc::now(),
            room_key: "room123".to_string(),
            file_id: Some(file_info.filename.clone()),
            file_info: Some(FileInfo {
                name: file_info.original_name.clone(),
                size: file_info.size,
                file_type: "application/pdf".to_string(),
                last_modified: 0,
            }),
            download_url: Some(format!("/api/files/{}", file_info.filename)),
        };
        room_service.add_message("room123", file_message).unwrap();

        // Verify message was stored
        let messages = room_service.get_messages("room123");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].message_type, MessageType::File);
        assert_eq!(messages[0].file_id, Some(file_info.filename.clone()));

        // Verify file is accessible
        let retrieved = file_manager.get_file(&file_info.filename);
        assert!(retrieved.is_some());

        // Cleanup
        let _ = tokio::fs::remove_dir_all(file_manager.upload_dir()).await;
    }

    #[tokio::test]
    async fn test_file_deduplication_across_rooms() {
        let file_manager = create_file_manager();
        let content = b"shared document content";

        // Upload same file to two different rooms
        let file1 = file_manager
            .save_file("room1", "shared.txt", "text/plain", content)
            .await
            .unwrap();

        let file2 = file_manager
            .save_file("room2", "shared.txt", "text/plain", content)
            .await
            .unwrap();

        // Same hash
        assert_eq!(file1.hash, file2.hash);

        // Second file is marked as duplicate
        assert_eq!(file2.is_duplicate, Some(true));

        // Both share the same physical file
        assert_eq!(file1.path, file2.path);

        // Stats should show 2 logical files
        let stats = file_manager.get_stats();
        assert_eq!(stats.total_files, 2);

        let _ = tokio::fs::remove_dir_all(file_manager.upload_dir()).await;
    }

    #[test]
    fn test_room_stats_accuracy() {
        let service = create_room_service();

        // Create multiple rooms with users
        service
            .join_room(JoinRoomRequest::new("room1", "u1", "User1", "s1").with_fingerprint("fp1"))
            .unwrap();
        service
            .join_room(
                JoinRoomRequest::new("room1", "u2", "User2", "s2")
                    .with_device_type("mobile")
                    .with_fingerprint("fp2"),
            )
            .unwrap();
        service
            .join_room(JoinRoomRequest::new("room2", "u3", "User3", "s3").with_fingerprint("fp3"))
            .unwrap();

        let stats = service.get_room_stats();
        assert_eq!(stats.total_rooms, 2);
        assert_eq!(stats.total_users, 3);
        assert_eq!(stats.online_users, 3);

        // Take one user offline
        service.set_user_offline("s1");
        let stats = service.get_room_stats();
        assert_eq!(stats.total_users, 3);
        assert_eq!(stats.online_users, 2);
    }
}
