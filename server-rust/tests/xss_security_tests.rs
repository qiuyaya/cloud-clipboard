/// XSS Security Tests
///
/// These tests verify the actual XSS prevention functions in the codebase,
/// including input sanitization, validation, and filename safety checks.
#[cfg(test)]
mod tests {
    use cloud_clipboard_server::routes::files::{is_dangerous_extension, is_valid_filename};
    use cloud_clipboard_server::utils::sanitize::sanitize_message_content;
    use cloud_clipboard_server::utils::validation::validate_room_key;

    // ===== sanitize_message_content tests =====

    #[test]
    fn test_sanitizes_script_tags() {
        let result = sanitize_message_content("<script>alert('xss')</script>");
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
        assert!(result.contains("&lt;script&gt;"));
    }

    #[test]
    fn test_sanitizes_case_insensitive_script_tags() {
        let inputs = vec![
            "<SCRIPT>alert('xss')</SCRIPT>",
            "<Script>alert('xss')</Script>",
        ];
        for input in inputs {
            let result = sanitize_message_content(input);
            assert!(!result.contains('<'), "Failed for input: {}", input);
            assert!(!result.contains('>'), "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_sanitizes_event_handlers() {
        let input = r#"<img src="x" onerror="alert(1)">"#;
        let result = sanitize_message_content(input);
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
        assert!(!result.contains('"'));
    }

    #[test]
    fn test_sanitizes_ampersand() {
        let result = sanitize_message_content("a & b");
        assert_eq!(result, "a &amp; b");
    }

    #[test]
    fn test_sanitizes_single_quotes() {
        let result = sanitize_message_content("it's");
        assert_eq!(result, "it&#x27;s");
    }

    #[test]
    fn test_sanitizes_all_special_characters() {
        let result = sanitize_message_content(r#"<div class="test">&'hello'</div>"#);
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
        assert!(!result.contains('"'));
        assert!(!result.contains('\''));
        // & should only appear as part of entities
        for part in result.split('&') {
            if !part.is_empty() {
                assert!(
                    part.starts_with("lt;")
                        || part.starts_with("gt;")
                        || part.starts_with("amp;")
                        || part.starts_with("quot;")
                        || part.starts_with("#x27;"),
                    "Unexpected & usage in: &{}",
                    part
                );
            }
        }
    }

    #[test]
    fn test_preserves_normal_text() {
        let inputs = vec![
            "Hello, world!",
            "This is a normal message",
            "Email: user@example.com",
            "Path: /home/user/file.txt",
            "Code: fn main() {{ }}",
        ];
        for input in inputs {
            let result = sanitize_message_content(input);
            assert_eq!(result, input, "Normal text should be preserved: {}", input);
        }
    }

    #[test]
    fn test_sanitizes_nested_tags() {
        let input = "<script><script>alert(1)</script></script>";
        let result = sanitize_message_content(input);
        assert!(!result.contains('<'));
    }

    #[test]
    fn test_sanitizes_javascript_protocol_in_content() {
        let input = r#"<a href="javascript:alert(1)">click</a>"#;
        let result = sanitize_message_content(input);
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
    }

    // ===== validate_room_key XSS prevention tests =====

    #[test]
    fn test_rejects_room_key_with_script_tags() {
        assert!(validate_room_key("<script>123</script>").is_err());
    }

    #[test]
    fn test_rejects_room_key_with_html_tags() {
        assert!(validate_room_key("<img>abc123").is_err());
        assert!(validate_room_key("room>key1").is_err());
    }

    #[test]
    fn test_rejects_room_key_with_special_characters() {
        assert!(validate_room_key("room@123").is_err());
        assert!(validate_room_key("room 123").is_err());
        assert!(validate_room_key("room.123").is_err());
        assert!(validate_room_key("room&123").is_err());
        assert!(validate_room_key("room\"123").is_err());
        assert!(validate_room_key("room'123").is_err());
    }

    #[test]
    fn test_accepts_valid_room_keys() {
        assert!(validate_room_key("room123").is_ok());
        assert!(validate_room_key("my_room-456").is_ok());
        assert!(validate_room_key("A1B2C3D4E5").is_ok());
    }

    #[test]
    fn test_rejects_room_key_too_short_or_long() {
        assert!(validate_room_key("ab1").is_err());
        let long = "a".repeat(49) + "1" + "x";
        assert!(validate_room_key(&long).is_err());
    }

    // ===== is_valid_filename XSS/injection prevention tests =====

    #[test]
    fn test_rejects_filename_with_html_tags() {
        assert!(!is_valid_filename("<script>.txt"));
        assert!(!is_valid_filename("file<img>.pdf"));
        assert!(!is_valid_filename("name>test.doc"));
    }

    #[test]
    fn test_rejects_filename_with_path_traversal() {
        assert!(!is_valid_filename("../../../etc/passwd"));
        assert!(!is_valid_filename("..\\..\\windows\\system32"));
        assert!(!is_valid_filename("file/../secret.txt"));
    }

    #[test]
    fn test_rejects_filename_with_special_characters() {
        assert!(!is_valid_filename("file|name.txt"));
        assert!(!is_valid_filename("file:name.txt"));
        assert!(!is_valid_filename("file*name.txt"));
        assert!(!is_valid_filename("file?name.txt"));
        assert!(!is_valid_filename(r#"file"name.txt"#));
    }

    #[test]
    fn test_accepts_valid_filenames() {
        assert!(is_valid_filename("document.pdf"));
        assert!(is_valid_filename("my-file_2024.txt"));
        assert!(is_valid_filename("photo.jpg"));
        assert!(is_valid_filename("report (final).docx"));
    }

    // ===== is_dangerous_extension tests =====

    #[test]
    fn test_detects_executable_extensions() {
        assert!(is_dangerous_extension("malware.exe"));
        assert!(is_dangerous_extension("script.bat"));
        assert!(is_dangerous_extension("payload.cmd"));
        assert!(is_dangerous_extension("installer.msi"));
    }

    #[test]
    fn test_detects_script_extensions() {
        assert!(is_dangerous_extension("backdoor.sh"));
        assert!(is_dangerous_extension("exploit.ps1"));
        assert!(is_dangerous_extension("dropper.vbs"));
        assert!(is_dangerous_extension("shell.php"));
    }

    #[test]
    fn test_detects_server_script_extensions() {
        assert!(is_dangerous_extension("page.asp"));
        assert!(is_dangerous_extension("page.aspx"));
        assert!(is_dangerous_extension("page.jsp"));
    }

    #[test]
    fn test_case_insensitive_extension_check() {
        assert!(is_dangerous_extension("malware.EXE"));
        assert!(is_dangerous_extension("script.Bat"));
        assert!(is_dangerous_extension("page.PHP"));
    }

    #[test]
    fn test_allows_safe_extensions() {
        assert!(!is_dangerous_extension("document.pdf"));
        assert!(!is_dangerous_extension("image.jpg"));
        assert!(!is_dangerous_extension("data.csv"));
        assert!(!is_dangerous_extension("archive.zip"));
        assert!(!is_dangerous_extension("text.txt"));
    }
}
