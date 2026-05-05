#![allow(dead_code)]

use engineioxide::Packet as EioPacket;
use serde::Serialize;
use socketioxide::packet::Packet;
use socketioxide_core::Value;
use socketioxide_core::parser::Parse;
use socketioxide_parser_common::CommonParser;
use std::time::Duration;

/// 编码 Socket.IO 事件为 Engine.IO Packet
pub fn create_socket_event(ns: &'static str, event: &str, data: impl Serialize) -> EioPacket {
    let val = CommonParser.encode_value(&data, Some(event)).unwrap();
    let packet = Packet::event(ns, val);
    match CommonParser.encode(packet) {
        Value::Str(data, _) => EioPacket::Message(data),
        Value::Bytes(_) => unreachable!(),
    }
}

/// 从 Engine.IO Packet 中解析 Socket.IO 事件名和数据
/// Socket.IO event packet format: 2["eventName", data]
/// Socket.IO connect ack format: 0{...}
pub fn parse_socket_event(packet: &EioPacket) -> Option<(String, serde_json::Value)> {
    match packet {
        EioPacket::Message(msg) => {
            if msg.starts_with("2[") {
                // Event packet: 2["eventName", data...]
                let inner = &msg[1..]; // Remove "2" prefix
                let arr: Vec<serde_json::Value> = serde_json::from_str(inner).ok()?;
                if arr.len() >= 2 {
                    let event_name = arr[0].as_str()?.to_string();
                    let data = arr[1].clone();
                    Some((event_name, data))
                } else if arr.len() == 1 {
                    let event_name = arr[0].as_str()?.to_string();
                    Some((event_name, serde_json::Value::Null))
                } else {
                    None
                }
            } else if msg.starts_with('0') {
                // Connect ack packet
                Some(("connect".to_string(), serde_json::Value::Null))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 等待接收下一个 Engine.IO Packet（带超时）
pub async fn recv_packet(
    rx: &mut tokio::sync::mpsc::Receiver<EioPacket>,
    timeout_ms: u64,
) -> Option<EioPacket> {
    tokio::time::timeout(Duration::from_millis(timeout_ms), rx.recv())
        .await
        .ok()
        .flatten()
}

/// 等待接收指定事件名的 Socket.IO 事件（带超时）
/// 跳过 connect ack 和其他不相关的事件
pub async fn recv_socket_event(
    rx: &mut tokio::sync::mpsc::Receiver<EioPacket>,
    expected_event: &str,
    timeout_ms: u64,
) -> Option<serde_json::Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline - tokio::time::Instant::now();
        let packet = tokio::time::timeout(remaining, rx.recv())
            .await
            .ok()
            .flatten()?;
        if let Some((event, data)) = parse_socket_event(&packet) {
            if event == expected_event {
                return Some(data);
            }
            // Skip other events (connect ack, etc.)
        }
    }
    None
}

/// 等待 connect ack
pub async fn wait_for_connect(
    rx: &mut tokio::sync::mpsc::Receiver<EioPacket>,
    timeout_ms: u64,
) -> bool {
    let packet = recv_packet(rx, timeout_ms).await;
    packet.is_some() && matches!(packet, Some(EioPacket::Message(s)) if s.starts_with('0'))
}
