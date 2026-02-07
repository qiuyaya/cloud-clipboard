use uuid::Uuid;

/// Generate a unique user ID
pub fn generate_user_id() -> String {
    format!("user_{}", Uuid::new_v4().to_string().replace("-", "")[..12].to_string())
}

/// Generate a unique message ID
pub fn generate_message_id() -> String {
    format!("msg_{}", Uuid::new_v4().to_string().replace("-", "")[..12].to_string())
}

/// Generate a unique share ID (8-10 characters)
pub fn generate_share_id() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    let length = rng.random_range(8..=10);

    (0..length)
        .map(|_| {
            let idx = rng.random_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_user_id() {
        let id = generate_user_id();
        assert!(id.starts_with("user_"));
        assert_eq!(id.len(), 17); // "user_" + 12 chars
    }

    #[test]
    fn test_generate_message_id() {
        let id = generate_message_id();
        assert!(id.starts_with("msg_"));
        assert_eq!(id.len(), 16); // "msg_" + 12 chars
    }

    #[test]
    fn test_generate_share_id() {
        let id = generate_share_id();
        assert!(id.len() >= 8 && id.len() <= 10);
        assert!(id.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
