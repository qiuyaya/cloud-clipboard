use uuid::Uuid;

/// Generate a unique user ID (UUID v4 format to match shared schema validation)
pub fn generate_user_id() -> String {
    Uuid::new_v4().to_string()
}

/// Generate a user ID from fingerprint hash (deterministic UUID v5)
pub fn generate_user_id_from_fingerprint(fingerprint_hash: &str) -> String {
    let namespace = Uuid::NAMESPACE_OID;
    Uuid::new_v5(&namespace, fingerprint_hash.as_bytes()).to_string()
}

/// Generate a unique message ID (UUID v4 format to match shared schema validation)
pub fn generate_message_id() -> String {
    Uuid::new_v4().to_string()
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
        assert!(
            Uuid::parse_str(&id).is_ok(),
            "User ID should be valid UUID: {}",
            id
        );
    }

    #[test]
    fn test_generate_user_id_from_fingerprint() {
        let id1 = generate_user_id_from_fingerprint("abc123");
        let id2 = generate_user_id_from_fingerprint("abc123");
        let id3 = generate_user_id_from_fingerprint("def456");
        assert!(
            Uuid::parse_str(&id1).is_ok(),
            "Fingerprint ID should be valid UUID: {}",
            id1
        );
        assert_eq!(id1, id2, "Same fingerprint should produce same ID");
        assert_ne!(
            id1, id3,
            "Different fingerprints should produce different IDs"
        );
    }

    #[test]
    fn test_generate_message_id() {
        let id = generate_message_id();
        assert!(
            Uuid::parse_str(&id).is_ok(),
            "Message ID should be valid UUID: {}",
            id
        );
    }

    #[test]
    fn test_generate_share_id() {
        let id = generate_share_id();
        assert!(id.len() >= 8 && id.len() <= 10);
        assert!(id.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
