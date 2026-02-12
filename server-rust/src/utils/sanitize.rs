/// Sanitize message content to prevent XSS attacks.
/// Escapes HTML special characters to their entity equivalents.
pub fn sanitize_message_content(content: &str) -> String {
    content
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_script_tag() {
        let input = "<script>alert('xss')</script>";
        let result = sanitize_message_content(input);
        assert_eq!(
            result,
            "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"
        );
        assert!(!result.contains('<'));
        assert!(!result.contains('>'));
    }

    #[test]
    fn test_sanitize_preserves_normal_text() {
        let input = "Hello, world! This is a normal message.";
        let result = sanitize_message_content(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_sanitize_html_entities() {
        let input = r#"<img src="x" onerror="alert(1)">"#;
        let result = sanitize_message_content(input);
        assert_eq!(
            result,
            "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;"
        );
    }

    #[test]
    fn test_sanitize_ampersand() {
        let input = "foo & bar";
        let result = sanitize_message_content(input);
        assert_eq!(result, "foo &amp; bar");
    }

    #[test]
    fn test_sanitize_empty_string() {
        assert_eq!(sanitize_message_content(""), "");
    }

    #[test]
    fn test_sanitize_mixed_content() {
        let input = "Hello <b>world</b> & \"friends\"";
        let result = sanitize_message_content(input);
        assert_eq!(
            result,
            "Hello &lt;b&gt;world&lt;/b&gt; &amp; &quot;friends&quot;"
        );
    }
}
