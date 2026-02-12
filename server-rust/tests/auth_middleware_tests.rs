/// Auth Middleware Tests
///
/// These tests verify authentication middleware behaviors matching
/// the Node.js backend implementation
#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    // Room key validation
    fn is_valid_room_key(key: &str) -> bool {
        // Length: 6-50 characters
        if key.len() < 6 || key.len() > 50 {
            return false;
        }

        // Must contain only alphanumeric, underscore, or hyphen
        if !key
            .chars()
            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            return false;
        }

        // Must contain at least one letter
        let has_letter = key.chars().any(|c| c.is_alphabetic());

        // Must contain at least one number
        let has_number = key.chars().any(|c| c.is_numeric());

        has_letter && has_number
    }

    // Request mock structure
    #[derive(Debug)]
    struct MockRequest {
        headers: HashMap<String, String>,
        body: HashMap<String, String>,
        query: HashMap<String, String>,
    }

    impl MockRequest {
        fn new() -> Self {
            Self {
                headers: HashMap::new(),
                body: HashMap::new(),
                query: HashMap::new(),
            }
        }

        fn with_header(mut self, key: &str, value: &str) -> Self {
            self.headers.insert(key.to_string(), value.to_string());
            self
        }

        fn with_body(mut self, key: &str, value: &str) -> Self {
            self.body.insert(key.to_string(), value.to_string());
            self
        }

        fn with_query(mut self, key: &str, value: &str) -> Self {
            self.query.insert(key.to_string(), value.to_string());
            self
        }
    }

    // Extract room key from request (priority: header > body > query)
    fn extract_room_key(req: &MockRequest) -> Option<String> {
        // Priority 1: Header
        if let Some(key) = req.headers.get("x-room-key") {
            return Some(key.clone());
        }

        // Priority 2: Body
        if let Some(key) = req.body.get("roomKey") {
            return Some(key.clone());
        }

        // Priority 3: Query
        if let Some(key) = req.query.get("roomKey") {
            return Some(key.clone());
        }

        None
    }

    // Authenticate room (required authentication)
    fn authenticate_room(req: &MockRequest) -> Result<String, (u16, String)> {
        let room_key = extract_room_key(req).ok_or((401, "Room key is required".to_string()))?;

        if !is_valid_room_key(&room_key) {
            return Err((401, "Invalid room key format".to_string()));
        }

        Ok(room_key)
    }

    // Optional room authentication
    fn optional_room_auth(req: &MockRequest) -> Option<String> {
        let room_key = extract_room_key(req)?;

        if is_valid_room_key(&room_key) {
            Some(room_key)
        } else {
            None
        }
    }

    // authenticateRoom tests
    #[test]
    fn test_extracts_room_key_from_header() {
        let req = MockRequest::new().with_header("x-room-key", "testroom123");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "testroom123");
    }

    #[test]
    fn test_extracts_room_key_from_body() {
        let req = MockRequest::new().with_body("roomKey", "testroom456");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "testroom456");
    }

    #[test]
    fn test_extracts_room_key_from_query() {
        let req = MockRequest::new().with_query("roomKey", "testroom789");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "testroom789");
    }

    #[test]
    fn test_prioritizes_header_over_body() {
        let req = MockRequest::new()
            .with_header("x-room-key", "header123")
            .with_body("roomKey", "body456");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "header123");
    }

    #[test]
    fn test_prioritizes_header_over_query() {
        let req = MockRequest::new()
            .with_header("x-room-key", "header123")
            .with_query("roomKey", "query789");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "header123");
    }

    #[test]
    fn test_prioritizes_body_over_query() {
        let req = MockRequest::new()
            .with_body("roomKey", "body456")
            .with_query("roomKey", "query789");

        let result = authenticate_room(&req);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "body456");
    }

    #[test]
    fn test_returns_401_when_room_key_is_missing() {
        let req = MockRequest::new();

        let result = authenticate_room(&req);
        assert!(result.is_err());
        let (status, message) = result.unwrap_err();
        assert_eq!(status, 401);
        assert_eq!(message, "Room key is required");
    }

    #[test]
    fn test_returns_401_for_invalid_room_key_format() {
        let req = MockRequest::new().with_header("x-room-key", "invalid");

        let result = authenticate_room(&req);
        assert!(result.is_err());
        let (status, _) = result.unwrap_err();
        assert_eq!(status, 401);
    }

    #[test]
    fn test_validates_room_key_format_valid_cases() {
        // Valid room keys
        assert!(is_valid_room_key("testroom123"));
        assert!(is_valid_room_key("room_123"));
        assert!(is_valid_room_key("test-room-456"));
        assert!(is_valid_room_key("MyRoom123"));
        assert!(is_valid_room_key("room123abc"));
    }

    #[test]
    fn test_validates_room_key_format_invalid_cases() {
        // Too short
        assert!(!is_valid_room_key("abc"));
        assert!(!is_valid_room_key("ab12"));

        // No numbers
        assert!(!is_valid_room_key("onlyletters"));
        assert!(!is_valid_room_key("test_room"));

        // No letters
        assert!(!is_valid_room_key("123456"));
        assert!(!is_valid_room_key("12-34-56"));

        // Invalid characters
        assert!(!is_valid_room_key("room@123"));
        assert!(!is_valid_room_key("room#123"));
        assert!(!is_valid_room_key("room 123"));
        assert!(!is_valid_room_key("room.123"));

        // Too long (>50 characters)
        assert!(!is_valid_room_key("a".repeat(51).as_str()));
    }

    #[test]
    fn test_validates_room_key_edge_cases() {
        // Minimum length (6 chars)
        assert!(is_valid_room_key("test12"));
        assert!(is_valid_room_key("ab1234"));

        // Maximum length (50 chars)
        let max_valid = format!("{}{}", "a".repeat(48), "12");
        assert_eq!(max_valid.len(), 50);
        assert!(is_valid_room_key(&max_valid));

        // Just over maximum
        let too_long = format!("{}{}", "a".repeat(49), "12");
        assert_eq!(too_long.len(), 51);
        assert!(!is_valid_room_key(&too_long));
    }

    // optionalRoomAuth tests
    #[test]
    fn test_optional_auth_with_valid_room_key() {
        let req = MockRequest::new().with_header("x-room-key", "testroom123");

        let result = optional_room_auth(&req);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), "testroom123");
    }

    #[test]
    fn test_optional_auth_with_missing_room_key() {
        let req = MockRequest::new();

        let result = optional_room_auth(&req);
        assert!(result.is_none());
    }

    #[test]
    fn test_optional_auth_with_invalid_room_key() {
        let req = MockRequest::new().with_header("x-room-key", "invalid");

        let result = optional_room_auth(&req);
        assert!(result.is_none());
    }
}
