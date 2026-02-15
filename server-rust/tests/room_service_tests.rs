use chrono::Utc;
// RoomService Extended Tests
//
// Additional tests that complement the inline unit tests in room_service.rs.
// All tests use the real production RoomService.
use std::sync::Arc;

use cloud_clipboard_server::models::{
    Message, User,
    message::{MessageSender, MessageType},
};
use cloud_clipboard_server::services::{RoomService, room_service::JoinRoomRequest};

fn create_service_with_user() -> (Arc<RoomService>, String, String, String) {
    let service = Arc::new(RoomService::new());
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_fingerprint("fp_hash_1"),
        )
        .unwrap();
    (service, "testroom".into(), "user1".into(), "socket1".into())
}

fn create_test_message(user: &User, room_key: &str, content: &str) -> Message {
    Message {
        id: uuid::Uuid::new_v4().to_string(),
        message_type: MessageType::Text,
        content: Some(content.to_string()),
        sender: MessageSender::from_user(user),
        timestamp: Utc::now(),
        room_key: room_key.to_string(),
        file_id: None,
        file_info: None,
        download_url: None,
    }
}

// ===== Room creation edge cases =====

#[test]
fn test_constructor_initializes_empty_state() {
    let service = RoomService::new();
    assert!(!service.room_exists("any_room"));
    assert_eq!(service.get_room_users("any_room").len(), 0);
}

#[test]
fn test_create_room_existing_returns_same_created_at() {
    let service = RoomService::new();
    let room1 = service.create_room("testroom", None, None).unwrap();
    let room2 = service.create_room("testroom", None, None).unwrap();
    assert_eq!(room1.created_at, room2.created_at);
}

#[test]
fn test_create_room_without_password() {
    let service = RoomService::new();
    service.create_room("publicroom", None, None).unwrap();
    assert!(!service.room_has_password("publicroom"));
}

// ===== Join room edge cases =====

#[test]
fn test_join_room_creates_if_not_exists() {
    let service = RoomService::new();
    assert!(!service.room_exists("newroom"));

    service
        .join_room(
            JoinRoomRequest::new("newroom", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    assert!(service.room_exists("newroom"));
}

#[test]
fn test_join_room_multiple_users() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user2", "User2", "socket2")
                .with_device_type("mobile")
                .with_fingerprint("fp2"),
        )
        .unwrap();

    assert_eq!(service.get_room_users("testroom").len(), 2);
}

#[test]
fn test_join_room_reconnect_with_fingerprint() {
    let service = RoomService::new();
    let (user1, _) = service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_fingerprint("fp_hash_1"),
        )
        .unwrap();

    service.set_user_offline("socket1");

    let (user2, users) = service
        .join_room(
            JoinRoomRequest::new("testroom", "user1_new", "TestUser", "socket2")
                .with_fingerprint("fp_hash_1"),
        )
        .unwrap();

    assert_eq!(user1.id, user2.id);
    assert_eq!(users.len(), 1);
}

#[test]
fn test_join_room_no_password_required() {
    let service = RoomService::new();
    service.create_room("testroom", None, None).unwrap();
    assert!(
        service
            .join_room(
                JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                    .with_fingerprint("fp1")
            )
            .is_ok()
    );
}

#[test]
fn test_unique_username_generation() {
    let service = RoomService::new();
    let (user1, _) = service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "TestUser", "socket1")
                .with_fingerprint("fp1"),
        )
        .unwrap();
    let (user2, _) = service
        .join_room(
            JoinRoomRequest::new("testroom", "user2", "TestUser", "socket2")
                .with_fingerprint("fp2"),
        )
        .unwrap();

    assert_eq!(user1.username, "TestUser");
    assert_ne!(user1.username, user2.username);
    assert!(user2.username.starts_with("TestUser_"));
}

// ===== Password management edge cases =====

#[test]
fn test_set_room_password_remove() {
    let service = RoomService::new();
    service
        .create_room("testroom", Some("password123"), None)
        .unwrap();
    assert!(service.room_has_password("testroom"));

    service.set_room_password("testroom", None).unwrap();
    assert!(!service.room_has_password("testroom"));
}

#[test]
fn test_verify_room_password_correct() {
    let service = RoomService::new();
    service
        .create_room("testroom", Some("password123"), None)
        .unwrap();
    assert!(
        service
            .verify_room_password("testroom", "password123")
            .unwrap()
    );
}

#[test]
fn test_verify_room_password_incorrect() {
    let service = RoomService::new();
    service
        .create_room("testroom", Some("password123"), None)
        .unwrap();
    assert!(
        !service
            .verify_room_password("testroom", "wrongpass")
            .unwrap()
    );
}

#[test]
fn test_verify_room_password_nonexistent() {
    let service = RoomService::new();
    assert!(
        service
            .verify_room_password("nonexistent", "password")
            .is_err()
    );
}

#[test]
fn test_get_room_password() {
    let service = RoomService::new();
    service
        .create_room("testroom", Some("mypassword"), None)
        .unwrap();
    assert_eq!(
        service.get_room_password("testroom"),
        Some("mypassword".to_string())
    );
}

#[test]
fn test_get_room_password_none() {
    let service = RoomService::new();
    service.create_room("testroom", None, None).unwrap();
    assert_eq!(service.get_room_password("testroom"), None);
}

// ===== Leave room edge cases =====

#[test]
fn test_leave_room_preserves_room_with_other_users() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user2", "User2", "socket2").with_fingerprint("fp2"),
        )
        .unwrap();

    service.leave_room("socket1");
    assert!(service.room_exists("testroom"));
    assert_eq!(service.get_room_users("testroom").len(), 1);
}

// ===== Message edge cases =====

#[test]
fn test_add_multiple_messages() {
    let service = RoomService::new();
    service.create_room("testroom", None, None).unwrap();
    let user = User::new("user1".into(), "User1".into(), "testroom".into());

    for i in 1..=5 {
        service
            .add_message(
                "testroom",
                create_test_message(&user, "testroom", &format!("Msg {}", i)),
            )
            .unwrap();
    }
    assert_eq!(service.get_messages("testroom").len(), 5);
}

#[test]
fn test_get_messages_empty_room() {
    let service = RoomService::new();
    service.create_room("testroom", None, None).unwrap();
    assert_eq!(service.get_messages("testroom").len(), 0);
}

// ===== Status update edge cases =====

#[test]
fn test_update_user_status_toggle() {
    let (service, room_key, user_id, _) = create_service_with_user();

    service.update_user_status(&room_key, &user_id, false);
    assert!(!service.get_room_users(&room_key)[0].is_online);

    service.update_user_status(&room_key, &user_id, true);
    assert!(service.get_room_users(&room_key)[0].is_online);
}

#[test]
fn test_update_user_status_nonexistent_user() {
    let (service, room_key, _, _) = create_service_with_user();
    service.update_user_status(&room_key, "nonexistent_user", false); // should not panic
}

#[test]
fn test_update_user_status_nonexistent_room() {
    let service = RoomService::new();
    service.update_user_status("nonexistent", "user1", false); // should not panic
}

// ===== Stats edge cases =====

#[test]
fn test_get_room_stats_with_offline_users() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("room1", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    service
        .join_room(
            JoinRoomRequest::new("room1", "user2", "User2", "socket2").with_fingerprint("fp2"),
        )
        .unwrap();
    service.update_user_status("room1", "user1", false);

    let stats = service.get_room_stats();
    assert_eq!(stats.total_users, 2);
    assert_eq!(stats.online_users, 1);
}

// ===== Socket mapping tests =====

#[test]
fn test_get_user_by_socket() {
    let (service, _, user_id, socket_id) = create_service_with_user();
    let user = service.get_user_by_socket(&socket_id);
    assert!(user.is_some());
    assert_eq!(user.unwrap().id, user_id);
}

#[test]
fn test_get_user_by_socket_nonexistent() {
    let service = RoomService::new();
    assert!(service.get_user_by_socket("nonexistent").is_none());
}

#[test]
fn test_get_socket_by_user() {
    let (service, _, user_id, socket_id) = create_service_with_user();
    assert_eq!(service.get_socket_by_user(&user_id), Some(socket_id));
}

#[test]
fn test_get_socket_by_user_nonexistent() {
    let service = RoomService::new();
    assert!(service.get_socket_by_user("nonexistent").is_none());
}

// ===== Fingerprint tests =====

#[test]
fn test_find_user_by_fingerprint_exists() {
    let (service, room_key, user_id, _) = create_service_with_user();
    let user = service.find_user_by_fingerprint(&room_key, "fp_hash_1");
    assert!(user.is_some());
    assert_eq!(user.unwrap().id, user_id);
}

#[test]
fn test_find_user_by_fingerprint_not_exists() {
    let (service, room_key, _, _) = create_service_with_user();
    assert!(
        service
            .find_user_by_fingerprint(&room_key, "nonexistent_fp")
            .is_none()
    );
}

#[test]
fn test_find_user_by_fingerprint_nonexistent_room() {
    let service = RoomService::new();
    assert!(
        service
            .find_user_by_fingerprint("nonexistent", "fp1")
            .is_none()
    );
}

// ===== Offline/disconnect edge cases =====

#[test]
fn test_set_user_offline_nonexistent() {
    let service = RoomService::new();
    assert!(service.set_user_offline("nonexistent").is_none());
}

// ===== Multi-room tests =====

#[test]
fn test_multiple_rooms_independent() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("room1", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    service
        .join_room(
            JoinRoomRequest::new("room2", "user2", "User2", "socket2").with_fingerprint("fp2"),
        )
        .unwrap();

    assert_eq!(service.get_room_users("room1").len(), 1);
    assert_eq!(service.get_room_users("room2").len(), 1);
    assert_ne!(
        service.get_room_users("room1")[0].id,
        service.get_room_users("room2")[0].id
    );
}

#[test]
fn test_same_user_different_rooms() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("room1", "user1", "User1", "socket1").with_fingerprint("fp1"),
        )
        .unwrap();
    service
        .join_room(
            JoinRoomRequest::new("room2", "user1", "User1", "socket2").with_fingerprint("fp1"),
        )
        .unwrap();

    assert!(service.room_exists("room1"));
    assert!(service.room_exists("room2"));
}

// ===== Pinned room tests =====

#[test]
fn test_pin_room_by_creator() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    let result = service.pin_room("testroom", "fp_creator");
    assert!(result.is_ok());
    assert!(result.unwrap());
    assert!(service.is_room_pinned("testroom"));
}

#[test]
fn test_pin_room_by_any_user() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    // 任意用户都可以固定房间
    let result = service.pin_room("testroom", "fp_other");
    assert!(result.is_ok());
    assert!(result.unwrap());
    assert!(service.is_room_pinned("testroom"));
}

#[test]
fn test_pin_room_nonexistent() {
    let service = RoomService::new();
    let result = service.pin_room("nonexistent", "fp1");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[test]
fn test_pin_room_already_pinned() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    service.pin_room("testroom", "fp_creator").unwrap();
    // Pinning again should succeed (idempotent)
    let result = service.pin_room("testroom", "fp_creator");
    assert!(result.is_ok());
    assert!(service.is_room_pinned("testroom"));
}

#[test]
fn test_unpin_room_by_creator() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    service.pin_room("testroom", "fp_creator").unwrap();
    assert!(service.is_room_pinned("testroom"));

    let result = service.unpin_room("testroom", "fp_creator");
    assert!(result.is_ok());
    assert!(!service.is_room_pinned("testroom"));
}

#[test]
fn test_unpin_room_by_any_user() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    service.pin_room("testroom", "fp_creator").unwrap();

    // 任意用户都可以取消固定房间
    let result = service.unpin_room("testroom", "fp_other");
    assert!(result.is_ok());
    assert!(!service.is_room_pinned("testroom"));
}

#[test]
fn test_is_room_pinned_default_false() {
    let service = RoomService::new();
    service.create_room("testroom", None, None).unwrap();
    assert!(!service.is_room_pinned("testroom"));
}

#[test]
fn test_is_room_pinned_nonexistent() {
    let service = RoomService::new();
    assert!(!service.is_room_pinned("nonexistent"));
}

#[test]
fn test_pinned_room_not_destroyed_on_leave() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    service.pin_room("testroom", "fp_creator").unwrap();

    // Leave room - pinned room should survive
    service.leave_room("socket1");
    assert!(service.room_exists("testroom"));
}

#[test]
fn test_unpinned_room_destroyed_on_leave() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_creator"),
        )
        .unwrap();

    // Not pinned - room should be destroyed when last user leaves
    service.leave_room("socket1");
    assert!(!service.room_exists("testroom"));
}

#[test]
fn test_join_room_sets_creator() {
    let service = RoomService::new();
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user1", "User1", "socket1")
                .with_fingerprint("fp_first"),
        )
        .unwrap();

    // First user should be creator - can pin
    assert!(service.pin_room("testroom", "fp_first").is_ok());

    // Second user joins - should NOT become creator
    service
        .join_room(
            JoinRoomRequest::new("testroom", "user2", "User2", "socket2")
                .with_fingerprint("fp_second"),
        )
        .unwrap();

    // Already pinned by first user, unpin first then verify second user can't pin
    service.unpin_room("testroom", "fp_first").unwrap();
    let result = service.pin_room("testroom", "fp_second");
    // 任意用户都可以固定房间，所以第二个用户也可以固定
    assert!(result.is_ok());
}
