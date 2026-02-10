/// Validate room key format.
///
/// Rules (matching Node.js RoomKeySchema):
/// - Length: 6-50 characters
/// - Character set: alphanumeric, underscore, hyphen only
/// - Complexity: must contain both letters and numbers
pub fn validate_room_key(key: &str) -> Result<(), &'static str> {
    if key.len() < 6 || key.len() > 50 {
        return Err("Room key must be 6-50 characters");
    }

    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Room key can only contain letters, numbers, underscores, and hyphens");
    }

    let has_letter = key.chars().any(|c| c.is_ascii_alphabetic());
    let has_number = key.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_number {
        return Err("Room key must contain both letters and numbers");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_room_key() {
        assert!(validate_room_key("abc123").is_ok());
        assert!(validate_room_key("my_room_1").is_ok());
        assert!(validate_room_key("test-room-99").is_ok());
        assert!(validate_room_key("A1B2C3D4E5").is_ok());
    }

    #[test]
    fn test_too_short() {
        assert_eq!(validate_room_key("abc1").unwrap_err(), "Room key must be 6-50 characters");
        assert_eq!(validate_room_key("a1b2c").unwrap_err(), "Room key must be 6-50 characters");
    }

    #[test]
    fn test_too_long() {
        let long_key = "a".repeat(49) + "1" + "x";
        assert_eq!(validate_room_key(&long_key).unwrap_err(), "Room key must be 6-50 characters");
    }

    #[test]
    fn test_invalid_characters() {
        assert_eq!(
            validate_room_key("abc 123").unwrap_err(),
            "Room key can only contain letters, numbers, underscores, and hyphens"
        );
        assert_eq!(
            validate_room_key("abc@123").unwrap_err(),
            "Room key can only contain letters, numbers, underscores, and hyphens"
        );
        assert_eq!(
            validate_room_key("abc.123").unwrap_err(),
            "Room key can only contain letters, numbers, underscores, and hyphens"
        );
    }

    #[test]
    fn test_missing_letters() {
        assert_eq!(
            validate_room_key("123456").unwrap_err(),
            "Room key must contain both letters and numbers"
        );
    }

    #[test]
    fn test_missing_numbers() {
        assert_eq!(
            validate_room_key("abcdef").unwrap_err(),
            "Room key must contain both letters and numbers"
        );
    }

    #[test]
    fn test_boundary_length() {
        // Exactly 6 chars
        assert!(validate_room_key("abc123").is_ok());
        // Exactly 50 chars
        let key_50 = "a".repeat(49) + "1";
        assert!(validate_room_key(&key_50).is_ok());
    }
}
