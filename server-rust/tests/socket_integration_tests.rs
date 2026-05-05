mod common;

use cloud_clipboard_server::services::RoomService;
use cloud_clipboard_server::services::socket::setup_socket_handlers;
use common::socket_helpers::*;
use engineioxide::Packet as EioPacket;
use serde_json::json;
use socketioxide::SocketIo;
use std::sync::Arc;
use std::time::Duration;

/// 创建测试用的 SocketIo + RoomService 环境
fn setup_test_env() -> (SocketIo, Arc<RoomService>) {
    let (_, io) = SocketIo::new_svc();
    let room_service = Arc::new(RoomService::new());
    setup_socket_handlers(&io, room_service.clone());
    (io, room_service)
}

/// 加入房间后，排空所有来自 join 的事件
/// handle_join_room 发送：userJoined, userList, roomPasswordSet, roomPinned
/// 以及广播：userJoined (to room), userList (to room)
async fn drain_join_events(rx: &mut tokio::sync::mpsc::Receiver<engineioxide::Packet>) {
    // 1. userJoined (from socket.emit)
    recv_socket_event(rx, "userJoined", 200).await;
    // 2. userList (from socket.emit)
    recv_socket_event(rx, "userList", 200).await;
    // 3. roomPasswordSet (from socket.emit, reporting current password state)
    recv_socket_event(rx, "roomPasswordSet", 200).await;
    // 4. roomPinned (from socket.emit, reporting current pinned state)
    recv_socket_event(rx, "roomPinned", 200).await;
}

#[tokio::test]
async fn test_join_room_success() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Send joinRoom event
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "test1234",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Should receive userJoined event
    let data = recv_socket_event(&mut srx, "userJoined", 200).await;
    assert!(data.is_some());
    let user_data = data.unwrap();
    assert_eq!(user_data["name"], "Alice");
}

#[tokio::test]
async fn test_join_room_password_required() {
    let (io, rs) = setup_test_env();

    // Create a password-protected room
    rs.create_room("secret1", Some("mypassword"), None).unwrap();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Try to join without password
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "secret1",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Should receive passwordRequired event
    let data = recv_socket_event(&mut srx, "passwordRequired", 200).await;
    assert!(data.is_some());
    assert_eq!(data.unwrap()["roomKey"], "secret1");
}

#[tokio::test]
async fn test_join_room_with_password_success() {
    let (io, rs) = setup_test_env();

    // Create a password-protected room
    rs.create_room("secret2", Some("mypassword"), None).unwrap();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join with correct password
    stx.try_send(create_socket_event(
        "/",
        "joinRoomWithPassword",
        json!({
            "roomKey": "secret2",
            "password": "mypassword",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Should receive userJoined event
    let data = recv_socket_event(&mut srx, "userJoined", 200).await;
    assert!(data.is_some());
    assert_eq!(data.unwrap()["name"], "Alice");
}

#[tokio::test]
async fn test_send_text_message() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // First join a room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "msgroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Wait for join events
    drain_join_events(&mut srx).await;

    // Send a text message
    stx.try_send(create_socket_event(
        "/",
        "sendMessage",
        json!({
            "roomKey": "msgroom",
            "type": "text",
            "content": "Hello world"
        }),
    ))
    .unwrap();

    // Should receive message event
    let data = recv_socket_event(&mut srx, "message", 200).await;
    assert!(data.is_some());
    let msg = data.unwrap();
    assert_eq!(msg["type"], "text");
    assert_eq!(msg["content"], "Hello world");
}

#[tokio::test]
async fn test_set_room_password() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // First join a room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "pwroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Wait for join events
    drain_join_events(&mut srx).await;

    // Set room password
    stx.try_send(create_socket_event(
        "/",
        "setRoomPassword",
        json!({
            "roomKey": "pwroom",
            "password": "newpass"
        }),
    ))
    .unwrap();

    // Should receive roomPasswordSet event
    let data = recv_socket_event(&mut srx, "roomPasswordSet", 200).await;
    assert!(data.is_some(), "Expected roomPasswordSet event");
    let event = data.unwrap();
    assert_eq!(event["roomKey"], "pwroom");
    assert_eq!(event["hasPassword"], true);
}

#[tokio::test]
async fn test_pin_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join with fingerprint
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "pinroom",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp123" }
        }),
    ))
    .unwrap();

    // Wait for join events
    drain_join_events(&mut srx).await;

    // Pin the room
    stx.try_send(create_socket_event(
        "/",
        "pinRoom",
        json!({
            "roomKey": "pinroom",
            "pinned": true
        }),
    ))
    .unwrap();

    // Should receive roomPinned event
    let data = recv_socket_event(&mut srx, "roomPinned", 200).await;
    assert!(data.is_some());
    let event = data.unwrap();
    assert_eq!(event["roomKey"], "pinroom");
    assert_eq!(event["isPinned"], true);
}

#[tokio::test]
async fn test_disconnect() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join a room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "discoom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Wait for join events
    recv_socket_event(&mut srx, "userJoined", 200).await;

    // Disconnect
    stx.try_send(EioPacket::Close).unwrap();

    // Just verify disconnect was processed - no specific event expected back
    tokio::time::sleep(Duration::from_millis(50)).await;
}

// ============================================================================
// 新增集成测试 - 覆盖更多 socket handler 分支
// ============================================================================

#[tokio::test]
async fn test_send_file_message() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room first
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "fileroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Send a file message
    stx.try_send(create_socket_event(
        "/",
        "sendMessage",
        json!({
            "roomKey": "fileroom",
            "type": "file",
            "fileInfo": { "name": "photo.jpg", "size": 2048, "type": "image/jpeg" },
            "downloadUrl": "/api/files/photo.jpg",
            "fileId": "file123"
        }),
    ))
    .unwrap();

    let data = recv_socket_event(&mut srx, "message", 200).await;
    assert!(data.is_some());
    let msg = data.unwrap();
    assert_eq!(msg["type"], "file");
    assert_eq!(msg["fileInfo"]["name"], "photo.jpg");
    assert_eq!(msg["fileInfo"]["size"], 2048);
    assert_eq!(msg["fileId"], "file123");
    assert_eq!(msg["downloadUrl"], "/api/files/photo.jpg");
}

#[tokio::test]
async fn test_send_file_message_minimal() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room first
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "minfileroom",
            "user": { "name": "Bob" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Send a file message without optional fields (should use defaults)
    stx.try_send(create_socket_event(
        "/",
        "sendMessage",
        json!({
            "roomKey": "minfileroom",
            "type": "file"
        }),
    ))
    .unwrap();

    let data = recv_socket_event(&mut srx, "message", 200).await;
    assert!(data.is_some());
    let msg = data.unwrap();
    assert_eq!(msg["type"], "file");
    // Default file_info values
    assert_eq!(msg["fileInfo"]["name"], "unknown");
    assert_eq!(msg["fileInfo"]["size"], 0);
    assert_eq!(msg["fileInfo"]["type"], "application/octet-stream");
}

#[tokio::test]
async fn test_leave_room_success() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room first
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "leaveroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Leave the room
    stx.try_send(create_socket_event(
        "/",
        "leaveRoom",
        json!({
            "roomKey": "leaveroom",
            "userId": "some-user-id"
        }),
    ))
    .unwrap();

    // No specific event expected back to the leaver, just verify no crash
    tokio::time::sleep(Duration::from_millis(50)).await;
}

#[tokio::test]
async fn test_recall_message_own_message() {
    let (io, rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room with fingerprint (to get a stable user ID)
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "recallroom",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_recall" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Send a text message
    stx.try_send(create_socket_event(
        "/",
        "sendMessage",
        json!({
            "roomKey": "recallroom",
            "type": "text",
            "content": "Hello world"
        }),
    ))
    .unwrap();

    let msg_data = recv_socket_event(&mut srx, "message", 200).await;
    assert!(msg_data.is_some());
    let message_id = msg_data.unwrap()["id"].as_str().unwrap().to_string();

    // Recall the message
    stx.try_send(create_socket_event(
        "/",
        "recallMessage",
        json!({
            "roomKey": "recallroom",
            "messageId": message_id
        }),
    ))
    .unwrap();

    // Should receive messageRecalled event
    let recall_data = recv_socket_event(&mut srx, "messageRecalled", 200).await;
    assert!(recall_data.is_some());
    assert_eq!(recall_data.unwrap()["messageId"], message_id);

    // Verify message is removed from room
    let messages = rs.get_messages("recallroom");
    assert!(messages.is_empty());
}

#[tokio::test]
async fn test_recall_message_other_user_message() {
    let (io, _rs) = setup_test_env();

    // User 1 joins with fingerprint
    let (stx1, mut srx1) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx1, 100).await;

    stx1.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "recallroom2",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx1).await;

    // User 1 sends a message
    stx1.try_send(create_socket_event(
        "/",
        "sendMessage",
        json!({
            "roomKey": "recallroom2",
            "type": "text",
            "content": "Alice's message"
        }),
    ))
    .unwrap();

    let msg_data = recv_socket_event(&mut srx1, "message", 200).await;
    assert!(msg_data.is_some());
    let message_id = msg_data.unwrap()["id"].as_str().unwrap().to_string();

    // Drain the message for user1 (it was broadcast)
    // User 2 joins
    let (stx2, mut srx2) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx2, 100).await;

    stx2.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "recallroom2",
            "user": { "name": "Bob" },
            "fingerprint": { "hash": "fp_bob" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx2).await;

    // User 2 tries to recall User 1's message (should fail)
    stx2.try_send(create_socket_event(
        "/",
        "recallMessage",
        json!({
            "roomKey": "recallroom2",
            "messageId": message_id
        }),
    ))
    .unwrap();

    // Should receive error event
    let error_data = recv_socket_event(&mut srx2, "error", 200).await;
    assert!(error_data.is_some());
    let error_msg = error_data.unwrap();
    // The error should say user can only recall own messages
    assert!(
        error_msg.as_str().unwrap().contains("recall")
            || error_msg.as_str().unwrap().contains("own")
    );
}

#[tokio::test]
async fn test_recall_message_not_found() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "recallroom3",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_recall3" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Try to recall a nonexistent message
    stx.try_send(create_socket_event(
        "/",
        "recallMessage",
        json!({
            "roomKey": "recallroom3",
            "messageId": "nonexistent-msg-id"
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}

#[tokio::test]
async fn test_pin_room_no_fingerprint() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room WITHOUT fingerprint
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "nopinroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Try to pin the room - should fail because no fingerprint
    stx.try_send(create_socket_event(
        "/",
        "pinRoom",
        json!({
            "roomKey": "nopinroom",
            "pinned": true
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
    let err = error_data.unwrap();
    assert!(
        err.as_str().unwrap().contains("fingerprint")
            || err.as_str().unwrap().contains("Fingerprint")
    );
}

#[tokio::test]
async fn test_unpin_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join with fingerprint
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "unpinroom",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_unpin" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // First pin the room
    stx.try_send(create_socket_event(
        "/",
        "pinRoom",
        json!({
            "roomKey": "unpinroom",
            "pinned": true
        }),
    ))
    .unwrap();

    let pin_data = recv_socket_event(&mut srx, "roomPinned", 200).await;
    assert!(pin_data.is_some());
    assert_eq!(pin_data.unwrap()["isPinned"], true);

    // Then unpin
    stx.try_send(create_socket_event(
        "/",
        "pinRoom",
        json!({
            "roomKey": "unpinroom",
            "pinned": false
        }),
    ))
    .unwrap();

    let unpin_data = recv_socket_event(&mut srx, "roomPinned", 200).await;
    assert!(unpin_data.is_some());
    assert_eq!(unpin_data.unwrap()["isPinned"], false);
}

#[tokio::test]
async fn test_share_room_link() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "shareroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Generate share link
    stx.try_send(create_socket_event(
        "/",
        "shareRoomLink",
        json!({
            "roomKey": "shareroom"
        }),
    ))
    .unwrap();

    let data = recv_socket_event(&mut srx, "roomLinkGenerated", 200).await;
    assert!(data.is_some());
    let event = data.unwrap();
    assert_eq!(event["roomKey"], "shareroom");
    let link = event["shareLink"].as_str().unwrap();
    assert!(link.contains("shareroom"));
}

#[tokio::test]
async fn test_share_room_link_not_in_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Try to share link without joining any room
    stx.try_send(create_socket_event(
        "/",
        "shareRoomLink",
        json!({
            "roomKey": "nonexistroom"
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}

#[tokio::test]
async fn test_set_room_password_remove() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "pwremoveroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // First set a password
    stx.try_send(create_socket_event(
        "/",
        "setRoomPassword",
        json!({
            "roomKey": "pwremoveroom",
            "password": "initialpass"
        }),
    ))
    .unwrap();

    let set_data = recv_socket_event(&mut srx, "roomPasswordSet", 200).await;
    assert!(set_data.is_some());
    assert_eq!(set_data.unwrap()["hasPassword"], true);

    // Now remove the password (password: null / not provided)
    stx.try_send(create_socket_event(
        "/",
        "setRoomPassword",
        json!({
            "roomKey": "pwremoveroom"
        }),
    ))
    .unwrap();

    let remove_data = recv_socket_event(&mut srx, "roomPasswordSet", 200).await;
    assert!(remove_data.is_some());
    assert_eq!(remove_data.unwrap()["hasPassword"], false);
}

#[tokio::test]
async fn test_set_room_password_auto_generate() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "pwautoroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Set password with empty string (should auto-generate UUID)
    stx.try_send(create_socket_event(
        "/",
        "setRoomPassword",
        json!({
            "roomKey": "pwautoroom",
            "password": ""
        }),
    ))
    .unwrap();

    let data = recv_socket_event(&mut srx, "roomPasswordSet", 200).await;
    assert!(data.is_some());
    assert_eq!(data.unwrap()["hasPassword"], true);
}

#[tokio::test]
async fn test_request_user_list() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "userlistroom",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Request user list
    stx.try_send(create_socket_event("/", "requestUserList", "userlistroom"))
        .unwrap();

    let data = recv_socket_event(&mut srx, "userList", 200).await;
    assert!(data.is_some());
    let users = data.unwrap();
    assert!(users.is_array());
    assert_eq!(users.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn test_join_room_with_message_history() {
    let (io, rs) = setup_test_env();

    // Create room and add messages via RoomService directly
    rs.create_room("histroom", None, None).unwrap();
    let user = cloud_clipboard_server::models::User::new(
        "histuser1".to_string(),
        "Alice".to_string(),
        "histroom".to_string(),
    );
    let msg = cloud_clipboard_server::models::Message::new_text(
        "msg1".to_string(),
        "histroom".to_string(),
        cloud_clipboard_server::models::message::MessageSender::from_user(&user),
        "Historical message".to_string(),
    );
    rs.add_message("histroom", msg).unwrap();

    // Now join the room via socket
    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "histroom",
            "user": { "name": "Bob" }
        }),
    ))
    .unwrap();

    // Should receive messageHistory event
    let data = recv_socket_event(&mut srx, "messageHistory", 200).await;
    assert!(data.is_some());
    let history = data.unwrap();
    assert!(history.is_array());
    assert_eq!(history.as_array().unwrap().len(), 1);
    assert_eq!(history[0]["content"], "Historical message");
}

#[tokio::test]
async fn test_join_room_with_password_wrong_password() {
    let (io, rs) = setup_test_env();

    // Create a password-protected room
    rs.create_room("wrongpw", Some("correctpass"), None)
        .unwrap();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Try to join with wrong password
    stx.try_send(create_socket_event(
        "/",
        "joinRoomWithPassword",
        json!({
            "roomKey": "wrongpw",
            "password": "wrongpass",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();

    // Should receive error event
    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}

#[tokio::test]
async fn test_disconnect_broadcasts_user_left() {
    let (io, _rs) = setup_test_env();

    // User 1 joins
    let (stx1, mut srx1) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx1, 100).await;

    stx1.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "discoom2",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_alice2" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx1).await;

    // User 2 joins the same room
    let (stx2, mut srx2) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx2, 100).await;

    stx2.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "discoom2",
            "user": { "name": "Bob" },
            "fingerprint": { "hash": "fp_bob2" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx2).await;

    // User 1 also receives userJoined for Bob
    // Drain that event
    recv_socket_event(&mut srx1, "userJoined", 200).await;
    recv_socket_event(&mut srx1, "userList", 200).await;

    // User 2 disconnects
    stx2.try_send(EioPacket::Close).unwrap();

    // User 1 should receive userLeft event (broadcast from socket.to(room))
    let left_data = recv_socket_event(&mut srx1, "userLeft", 200).await;
    assert!(left_data.is_some());
}

#[tokio::test]
async fn test_set_room_password_not_in_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room A
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "roomA",
            "user": { "name": "Alice" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Try to set password for room B (different room)
    stx.try_send(create_socket_event(
        "/",
        "setRoomPassword",
        json!({
            "roomKey": "roomB",
            "password": "newpass"
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}

#[tokio::test]
async fn test_pin_room_not_in_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room A
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "roomA2",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_pinA" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Try to pin room B (different room)
    stx.try_send(create_socket_event(
        "/",
        "pinRoom",
        json!({
            "roomKey": "roomB2",
            "pinned": true
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}

#[tokio::test]
async fn test_recall_message_not_in_room() {
    let (io, _rs) = setup_test_env();

    let (stx, mut srx) = io.new_dummy_sock("/", ()).await;
    wait_for_connect(&mut srx, 100).await;

    // Join room A
    stx.try_send(create_socket_event(
        "/",
        "joinRoom",
        json!({
            "roomKey": "roomA3",
            "user": { "name": "Alice" },
            "fingerprint": { "hash": "fp_recallA" }
        }),
    ))
    .unwrap();
    drain_join_events(&mut srx).await;

    // Try to recall a message in room B
    stx.try_send(create_socket_event(
        "/",
        "recallMessage",
        json!({
            "roomKey": "roomB3",
            "messageId": "some-msg-id"
        }),
    ))
    .unwrap();

    let error_data = recv_socket_event(&mut srx, "error", 200).await;
    assert!(error_data.is_some());
}
